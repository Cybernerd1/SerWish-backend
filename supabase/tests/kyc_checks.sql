-- Partner KYC rules: run after the migrations + seed (scripts/db-check.sh).
do $$
declare
  v text;
  ok boolean;
begin
  insert into users (id, name, phone) values ('kyc_chk_p', 'Check Partner', '9000000101') on conflict do nothing;
  insert into users (id, name, phone, is_admin) values ('kyc_chk_a', 'Check Admin', '9000000102', true) on conflict do nothing;
  insert into provider_profiles (user_id) values ('kyc_chk_p') on conflict do nothing;
  update provider_profiles set kyc_status = 'in_progress' where user_id = 'kyc_chk_p';
  insert into partner_kyc (partner_id, id_state, selfie_state, bank_state, selfie_attempts)
  values ('kyc_chk_p', 'review', 'review', 'done', 3)
  on conflict (partner_id) do update set id_state = 'review', selfie_state = 'review', bank_state = 'done', selfie_attempts = 3;

  -- Cannot decide before submission.
  begin
    perform kyc_decide('kyc_chk_p', 'kyc_chk_a', true);
    raise exception 'decided an unsubmitted verification';
  exception when others then
    if sqlerrm not like '%submitted%' then raise; end if;
  end;

  update provider_profiles set kyc_status = 'pending', kyc_submitted_at = now() where user_id = 'kyc_chk_p';

  -- Rejecting needs a reason.
  begin
    perform kyc_decide('kyc_chk_p', 'kyc_chk_a', false);
    raise exception 'rejected without a reason';
  exception when others then
    if sqlerrm not like '%reason%' then raise; end if;
  end;

  perform kyc_decide('kyc_chk_p', 'kyc_chk_a', false, array['Blurry selfie'], null, array['selfie']);
  select kyc_status::text into v from provider_profiles where user_id = 'kyc_chk_p';
  if v <> 'rejected' then raise exception 'expected rejected, got %', v; end if;
  select selfie_state = 'failed' and selfie_attempts = 0 and id_state = 'review' into ok from partner_kyc where partner_id = 'kyc_chk_p';
  if not ok then raise exception 'reject did not reset only the failed step'; end if;

  update provider_profiles set kyc_status = 'pending' where user_id = 'kyc_chk_p';
  perform kyc_decide('kyc_chk_p', 'kyc_chk_a', true);
  select kyc_status::text into v from provider_profiles where user_id = 'kyc_chk_p';
  if v <> 'approved' then raise exception 'expected approved, got %', v; end if;
  select id_state = 'done' and rejection_reasons = '{}' into ok from partner_kyc where partner_id = 'kyc_chk_p';
  if not ok then raise exception 'approve did not settle review steps'; end if;
  if (select count(*) from kyc_events where partner_id = 'kyc_chk_p' and kind = 'admin.decision') <> 2 then
    raise exception 'decisions not recorded';
  end if;

  -- Masked values only.
  begin
    update partner_kyc set id_aadhaar_last4 = '123456789012' where partner_id = 'kyc_chk_p';
    raise exception 'stored a full Aadhaar number';
  exception when check_violation then null;
  end;

  delete from provider_profiles where user_id = 'kyc_chk_p';
  delete from users where id in ('kyc_chk_p', 'kyc_chk_a');
  raise notice 'SerWish KYC checks: all passed';
end $$;

-- Client roles see nothing; history cannot be rewritten by the API role.
do $$
begin
  if has_table_privilege('anon', 'partner_kyc', 'select') or has_table_privilege('authenticated', 'partner_kyc', 'select') then
    raise exception 'client roles can read partner_kyc';
  end if;
  if has_table_privilege('service_role', 'kyc_events', 'update') or has_table_privilege('service_role', 'kyc_events', 'delete') then
    raise exception 'kyc_events is not append-only';
  end if;
  if has_function_privilege('anon', 'kyc_decide(text, text, boolean, text[], text, text[])', 'execute') then
    raise exception 'anon can call kyc_decide';
  end if;
  raise notice 'SerWish KYC lockdown checks: all passed';
end $$;
