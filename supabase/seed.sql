-- =============================================================================
-- SerWish demo seed (development and Play Store testing only)
-- Generated from serwishapp/src/data/catalog.ts so the app fixtures and the API
-- return the same catalogue. Safe to re-run: every insert is an upsert.
-- Never run against production with real partners: the demo partners below
-- are fake accounts (ids start with seed_) located in Gurugram.
-- =============================================================================
set search_path = public, extensions;

-- Categories
insert into categories (slug, name, icon, image_url, group_name, tagline, display_order)
values ('cleaning', 'Cleaning', 'cleaning', 'https://images.unsplash.com/photo-1740657254989-42fe9c3b8cce?q=80&w=600&auto=format&fit=crop', 'Home Care', 'Soft. Safe. Spotless.', 1)
on conflict (slug) do update set name = excluded.name, icon = excluded.icon, image_url = excluded.image_url,
  group_name = excluded.group_name, tagline = excluded.tagline, display_order = excluded.display_order;
insert into categories (slug, name, icon, image_url, group_name, tagline, display_order)
values ('plumbing', 'Plumbing', 'plumbing', 'https://images.unsplash.com/photo-1676210133055-eab6ef033ce3?q=80&w=600&auto=format&fit=crop', 'Repairs', 'Leak-free living.', 2)
on conflict (slug) do update set name = excluded.name, icon = excluded.icon, image_url = excluded.image_url,
  group_name = excluded.group_name, tagline = excluded.tagline, display_order = excluded.display_order;
insert into categories (slug, name, icon, image_url, group_name, tagline, display_order)
values ('electrician', 'Electrician', 'electrician', 'https://images.unsplash.com/photo-1660330589693-99889d60181e?q=80&w=600&auto=format&fit=crop', 'Repairs', 'Safe wiring, bright homes.', 3)
on conflict (slug) do update set name = excluded.name, icon = excluded.icon, image_url = excluded.image_url,
  group_name = excluded.group_name, tagline = excluded.tagline, display_order = excluded.display_order;
insert into categories (slug, name, icon, image_url, group_name, tagline, display_order)
values ('ac-service', 'AC Service', 'ac', 'https://images.unsplash.com/photo-1759772238012-9d5ad59ae637?q=80&w=600&auto=format&fit=crop', 'Appliances', 'Cooling experts, at your service.', 4)
on conflict (slug) do update set name = excluded.name, icon = excluded.icon, image_url = excluded.image_url,
  group_name = excluded.group_name, tagline = excluded.tagline, display_order = excluded.display_order;
insert into categories (slug, name, icon, image_url, group_name, tagline, display_order)
values ('salon', 'Salon at Home', 'salon', 'https://images.unsplash.com/photo-1634449571010-02389ed0f9b0?q=80&w=600&auto=format&fit=crop', 'Beauty & Wellness', 'Salon-grade, at home.', 5)
on conflict (slug) do update set name = excluded.name, icon = excluded.icon, image_url = excluded.image_url,
  group_name = excluded.group_name, tagline = excluded.tagline, display_order = excluded.display_order;
insert into categories (slug, name, icon, image_url, group_name, tagline, display_order)
values ('pest-control', 'Pest Control', 'pest', 'https://images.unsplash.com/photo-1747659629851-a92bd71149f6?q=80&w=600&auto=format&fit=crop', 'Pest Control', 'Safe for kids and pets.', 6)
on conflict (slug) do update set name = excluded.name, icon = excluded.icon, image_url = excluded.image_url,
  group_name = excluded.group_name, tagline = excluded.tagline, display_order = excluded.display_order;
insert into categories (slug, name, icon, image_url, group_name, tagline, display_order)
values ('carpentry', 'Carpentry', 'carpentry', 'https://images.unsplash.com/photo-1687422810663-c316494f725a?q=80&w=600&auto=format&fit=crop', 'Repairs', 'Fix, fit and assemble.', 7)
on conflict (slug) do update set name = excluded.name, icon = excluded.icon, image_url = excluded.image_url,
  group_name = excluded.group_name, tagline = excluded.tagline, display_order = excluded.display_order;
insert into categories (slug, name, icon, image_url, group_name, tagline, display_order)
values ('appliance-repair', 'Appliances', 'appliance', 'https://images.unsplash.com/photo-1604335399105-a0c585fd81a1?q=80&w=600&auto=format&fit=crop', 'Appliances', 'Washers, fridges and more.', 8)
on conflict (slug) do update set name = excluded.name, icon = excluded.icon, image_url = excluded.image_url,
  group_name = excluded.group_name, tagline = excluded.tagline, display_order = excluded.display_order;
insert into categories (slug, name, icon, image_url, group_name, tagline, display_order)
values ('painting', 'Painting', 'painting', 'https://images.unsplash.com/photo-1562259949-e8e7689d7828?q=80&w=600&auto=format&fit=crop', 'Moving & Cleaning', 'Fresh walls in a day.', 9)
on conflict (slug) do update set name = excluded.name, icon = excluded.icon, image_url = excluded.image_url,
  group_name = excluded.group_name, tagline = excluded.tagline, display_order = excluded.display_order;
insert into categories (slug, name, icon, image_url, group_name, tagline, display_order)
values ('car-care', 'Car Care', 'car', 'https://images.unsplash.com/photo-1607860108855-64acf2078ed9?q=80&w=600&auto=format&fit=crop', 'Car Care', 'Showroom shine at your door.', 10)
on conflict (slug) do update set name = excluded.name, icon = excluded.icon, image_url = excluded.image_url,
  group_name = excluded.group_name, tagline = excluded.tagline, display_order = excluded.display_order;

-- Services, packages and extras
insert into services (category_id, slug, name, subtitle, description, image_url, base_price, duration_mins, included, rating_avg, rating_count, display_order)
select id, 'home-clean', 'Home Cleaning', 'Full home, top to bottom', 'Trained professionals clean every room with safe, pet-friendly products. Bring nothing; we carry all tools.', 'https://images.unsplash.com/photo-1740657254989-42fe9c3b8cce?q=80&w=600&auto=format&fit=crop', 299, 120, array['Dusting of all reachable surfaces', 'Floor vacuum and mop', 'Kitchen and bathroom wipe-down', 'Trash removal']::text[], 4.8, 1248, 1
from categories where slug = 'cleaning'
on conflict (slug) do update set category_id = excluded.category_id, name = excluded.name, subtitle = excluded.subtitle,
  description = excluded.description, image_url = excluded.image_url, base_price = excluded.base_price,
  duration_mins = excluded.duration_mins, included = excluded.included, rating_avg = excluded.rating_avg,
  rating_count = excluded.rating_count, display_order = excluded.display_order;
delete from service_packages where service_id = (select id from services where slug = 'home-clean');
delete from service_extras where service_id = (select id from services where slug = 'home-clean');
insert into service_packages (service_id, name, price, duration_mins, pros_count, includes, is_popular, display_order)
select s.id, v.* from services s, (values
  ('Basic', 299, 120, 1, array['Dusting and wiping', 'Floor mopping', 'Bin cleaning']::text[], false, 1),
  ('Standard', 404, 180, 2, array['Everything in Basic', 'Kitchen surfaces', 'Bathroom scrub']::text[], true, 2),
  ('Premium', 703, 240, 3, array['Everything in Standard', 'Machine scrubbing', 'Upholstery vacuum']::text[], false, 3)
) as v(name, price, duration_mins, pros_count, includes, is_popular, display_order) where s.slug = 'home-clean';
insert into service_extras (service_id, name, price, display_order)
select s.id, v.* from services s, (values ('Inside Fridge', 99, 1), ('Inside Oven', 99, 2), ('Balcony Cleaning', 149, 3), ('Window Cleaning', 149, 4), ('Eco-friendly Products', 49, 5)) as v(name, price, display_order) where s.slug = 'home-clean';
insert into services (category_id, slug, name, subtitle, description, image_url, base_price, duration_mins, included, rating_avg, rating_count, display_order)
select id, 'bath-clean', 'Bathroom Cleaning', 'Tiles, fittings, stains', 'Deep scrub for tiles, taps, mirrors and fittings, including hard-water stain removal.', 'https://images.unsplash.com/photo-1759691337823-5b348f5fd98d?q=80&w=600&auto=format&fit=crop', 349, 60, array['Tile and grout scrub', 'Tap and shower descaling', 'Mirror polish', 'Floor disinfect']::text[], 4.7, 842, 2
from categories where slug = 'cleaning'
on conflict (slug) do update set category_id = excluded.category_id, name = excluded.name, subtitle = excluded.subtitle,
  description = excluded.description, image_url = excluded.image_url, base_price = excluded.base_price,
  duration_mins = excluded.duration_mins, included = excluded.included, rating_avg = excluded.rating_avg,
  rating_count = excluded.rating_count, display_order = excluded.display_order;
delete from service_packages where service_id = (select id from services where slug = 'bath-clean');
delete from service_extras where service_id = (select id from services where slug = 'bath-clean');
insert into service_packages (service_id, name, price, duration_mins, pros_count, includes, is_popular, display_order)
select s.id, v.* from services s, (values
  ('Basic', 349, 120, 1, array['Dusting and wiping', 'Floor mopping', 'Bin cleaning']::text[], false, 1),
  ('Standard', 471, 180, 2, array['Everything in Basic', 'Kitchen surfaces', 'Bathroom scrub']::text[], true, 2),
  ('Premium', 820, 240, 3, array['Everything in Standard', 'Machine scrubbing', 'Upholstery vacuum']::text[], false, 3)
) as v(name, price, duration_mins, pros_count, includes, is_popular, display_order) where s.slug = 'bath-clean';
insert into service_extras (service_id, name, price, display_order)
select s.id, v.* from services s, (values ('Eco-friendly Products', 49, 1)) as v(name, price, display_order) where s.slug = 'bath-clean';
insert into services (category_id, slug, name, subtitle, description, image_url, base_price, duration_mins, included, rating_avg, rating_count, display_order)
select id, 'kitchen-clean', 'Kitchen Cleaning', 'Degrease and shine', 'Grease removal from slab, tiles, chimney exterior and cabinets.', 'https://images.unsplash.com/photo-1556911220-bff31c812dba?q=80&w=600&auto=format&fit=crop', 449, 120, array['Slab and sink degrease', 'Cabinet exterior wipe', 'Chimney exterior', 'Floor mop']::text[], 4.7, 611, 3
from categories where slug = 'cleaning'
on conflict (slug) do update set category_id = excluded.category_id, name = excluded.name, subtitle = excluded.subtitle,
  description = excluded.description, image_url = excluded.image_url, base_price = excluded.base_price,
  duration_mins = excluded.duration_mins, included = excluded.included, rating_avg = excluded.rating_avg,
  rating_count = excluded.rating_count, display_order = excluded.display_order;
delete from service_packages where service_id = (select id from services where slug = 'kitchen-clean');
delete from service_extras where service_id = (select id from services where slug = 'kitchen-clean');
insert into service_packages (service_id, name, price, duration_mins, pros_count, includes, is_popular, display_order)
select s.id, v.* from services s, (values
  ('Basic', 449, 120, 1, array['Dusting and wiping', 'Floor mopping', 'Bin cleaning']::text[], false, 1),
  ('Standard', 606, 180, 2, array['Everything in Basic', 'Kitchen surfaces', 'Bathroom scrub']::text[], true, 2),
  ('Premium', 1055, 240, 3, array['Everything in Standard', 'Machine scrubbing', 'Upholstery vacuum']::text[], false, 3)
) as v(name, price, duration_mins, pros_count, includes, is_popular, display_order) where s.slug = 'kitchen-clean';
insert into service_extras (service_id, name, price, display_order)
select s.id, v.* from services s, (values ('Inside Fridge', 99, 1), ('Inside Oven', 99, 2)) as v(name, price, display_order) where s.slug = 'kitchen-clean';
insert into services (category_id, slug, name, subtitle, description, image_url, base_price, duration_mins, included, rating_avg, rating_count, display_order)
select id, 'sofa-clean', 'Sofa Cleaning', 'Shampoo and vacuum', 'Fabric-safe shampoo and extraction for sofas, cushions and chairs.', 'https://images.unsplash.com/photo-1686178827149-6d55c72d81df?q=80&w=600&auto=format&fit=crop', 399, 90, array['Dry vacuum', 'Foam shampoo', 'Stain treatment', 'Quick-dry extraction']::text[], 4.6, 530, 4
from categories where slug = 'cleaning'
on conflict (slug) do update set category_id = excluded.category_id, name = excluded.name, subtitle = excluded.subtitle,
  description = excluded.description, image_url = excluded.image_url, base_price = excluded.base_price,
  duration_mins = excluded.duration_mins, included = excluded.included, rating_avg = excluded.rating_avg,
  rating_count = excluded.rating_count, display_order = excluded.display_order;
delete from service_packages where service_id = (select id from services where slug = 'sofa-clean');
delete from service_extras where service_id = (select id from services where slug = 'sofa-clean');
insert into service_packages (service_id, name, price, duration_mins, pros_count, includes, is_popular, display_order)
select s.id, v.* from services s, (values
  ('Basic', 399, 120, 1, array['Dusting and wiping', 'Floor mopping', 'Bin cleaning']::text[], false, 1),
  ('Standard', 539, 180, 2, array['Everything in Basic', 'Kitchen surfaces', 'Bathroom scrub']::text[], true, 2),
  ('Premium', 938, 240, 3, array['Everything in Standard', 'Machine scrubbing', 'Upholstery vacuum']::text[], false, 3)
) as v(name, price, duration_mins, pros_count, includes, is_popular, display_order) where s.slug = 'sofa-clean';
insert into services (category_id, slug, name, subtitle, description, image_url, base_price, duration_mins, included, rating_avg, rating_count, display_order)
select id, 'ac', 'AC Service', 'Jet clean and gas check', 'Filter and coil jet wash, drain cleaning and cooling check for split and window ACs.', 'https://images.unsplash.com/photo-1759772238012-9d5ad59ae637?q=80&w=600&auto=format&fit=crop', 499, 60, array['Filter and coil jet wash', 'Drain pipe cleaning', 'Gas pressure check', 'Cooling test']::text[], 4.8, 2210, 5
from categories where slug = 'ac-service'
on conflict (slug) do update set category_id = excluded.category_id, name = excluded.name, subtitle = excluded.subtitle,
  description = excluded.description, image_url = excluded.image_url, base_price = excluded.base_price,
  duration_mins = excluded.duration_mins, included = excluded.included, rating_avg = excluded.rating_avg,
  rating_count = excluded.rating_count, display_order = excluded.display_order;
delete from service_packages where service_id = (select id from services where slug = 'ac');
delete from service_extras where service_id = (select id from services where slug = 'ac');
insert into service_packages (service_id, name, price, duration_mins, pros_count, includes, is_popular, display_order)
select s.id, v.* from services s, (values
  ('Basic', 499, 120, 1, array['Dusting and wiping', 'Floor mopping', 'Bin cleaning']::text[], false, 1),
  ('Standard', 674, 180, 2, array['Everything in Basic', 'Kitchen surfaces', 'Bathroom scrub']::text[], true, 2),
  ('Premium', 1173, 240, 3, array['Everything in Standard', 'Machine scrubbing', 'Upholstery vacuum']::text[], false, 3)
) as v(name, price, duration_mins, pros_count, includes, is_popular, display_order) where s.slug = 'ac';
insert into services (category_id, slug, name, subtitle, description, image_url, base_price, duration_mins, included, rating_avg, rating_count, display_order)
select id, 'plumb', 'Tap and Leak Repair', 'Taps, pipes, flush', 'Fix leaking taps, pipes, flush tanks and blocked drains.', 'https://images.unsplash.com/photo-1676210133055-eab6ef033ce3?q=80&w=600&auto=format&fit=crop', 199, 45, array['Leak diagnosis', 'Washer and cartridge change', 'Drain unblock', '30-day repair warranty']::text[], 4.7, 980, 6
from categories where slug = 'plumbing'
on conflict (slug) do update set category_id = excluded.category_id, name = excluded.name, subtitle = excluded.subtitle,
  description = excluded.description, image_url = excluded.image_url, base_price = excluded.base_price,
  duration_mins = excluded.duration_mins, included = excluded.included, rating_avg = excluded.rating_avg,
  rating_count = excluded.rating_count, display_order = excluded.display_order;
delete from service_packages where service_id = (select id from services where slug = 'plumb');
delete from service_extras where service_id = (select id from services where slug = 'plumb');
insert into service_packages (service_id, name, price, duration_mins, pros_count, includes, is_popular, display_order)
select s.id, v.* from services s, (values
  ('Basic', 199, 120, 1, array['Dusting and wiping', 'Floor mopping', 'Bin cleaning']::text[], false, 1),
  ('Standard', 269, 180, 2, array['Everything in Basic', 'Kitchen surfaces', 'Bathroom scrub']::text[], true, 2),
  ('Premium', 468, 240, 3, array['Everything in Standard', 'Machine scrubbing', 'Upholstery vacuum']::text[], false, 3)
) as v(name, price, duration_mins, pros_count, includes, is_popular, display_order) where s.slug = 'plumb';
insert into services (category_id, slug, name, subtitle, description, image_url, base_price, duration_mins, included, rating_avg, rating_count, display_order)
select id, 'elec', 'Switch and Wiring', 'Switches, sockets, fans', 'Install or repair switches, sockets, fans and lights with safety checks.', 'https://images.unsplash.com/photo-1660330589693-99889d60181e?q=80&w=600&auto=format&fit=crop', 149, 45, array['Fault diagnosis', 'Switch or socket replacement', 'Fan and light fitting', 'Safety test']::text[], 4.7, 1422, 7
from categories where slug = 'electrician'
on conflict (slug) do update set category_id = excluded.category_id, name = excluded.name, subtitle = excluded.subtitle,
  description = excluded.description, image_url = excluded.image_url, base_price = excluded.base_price,
  duration_mins = excluded.duration_mins, included = excluded.included, rating_avg = excluded.rating_avg,
  rating_count = excluded.rating_count, display_order = excluded.display_order;
delete from service_packages where service_id = (select id from services where slug = 'elec');
delete from service_extras where service_id = (select id from services where slug = 'elec');
insert into service_packages (service_id, name, price, duration_mins, pros_count, includes, is_popular, display_order)
select s.id, v.* from services s, (values
  ('Basic', 149, 120, 1, array['Dusting and wiping', 'Floor mopping', 'Bin cleaning']::text[], false, 1),
  ('Standard', 201, 180, 2, array['Everything in Basic', 'Kitchen surfaces', 'Bathroom scrub']::text[], true, 2),
  ('Premium', 350, 240, 3, array['Everything in Standard', 'Machine scrubbing', 'Upholstery vacuum']::text[], false, 3)
) as v(name, price, duration_mins, pros_count, includes, is_popular, display_order) where s.slug = 'elec';
insert into services (category_id, slug, name, subtitle, description, image_url, base_price, duration_mins, included, rating_avg, rating_count, display_order)
select id, 'pest', 'Pest Control', 'Cockroach and ant', 'Odourless gel and spray treatment, safe for children and pets.', 'https://images.unsplash.com/photo-1747659629851-a92bd71149f6?q=80&w=600&auto=format&fit=crop', 399, 60, array['Kitchen gel treatment', 'Crack and crevice spray', 'Follow-up visit in 30 days']::text[], 4.6, 760, 8
from categories where slug = 'pest-control'
on conflict (slug) do update set category_id = excluded.category_id, name = excluded.name, subtitle = excluded.subtitle,
  description = excluded.description, image_url = excluded.image_url, base_price = excluded.base_price,
  duration_mins = excluded.duration_mins, included = excluded.included, rating_avg = excluded.rating_avg,
  rating_count = excluded.rating_count, display_order = excluded.display_order;
delete from service_packages where service_id = (select id from services where slug = 'pest');
delete from service_extras where service_id = (select id from services where slug = 'pest');
insert into service_packages (service_id, name, price, duration_mins, pros_count, includes, is_popular, display_order)
select s.id, v.* from services s, (values
  ('Basic', 399, 120, 1, array['Dusting and wiping', 'Floor mopping', 'Bin cleaning']::text[], false, 1),
  ('Standard', 539, 180, 2, array['Everything in Basic', 'Kitchen surfaces', 'Bathroom scrub']::text[], true, 2),
  ('Premium', 938, 240, 3, array['Everything in Standard', 'Machine scrubbing', 'Upholstery vacuum']::text[], false, 3)
) as v(name, price, duration_mins, pros_count, includes, is_popular, display_order) where s.slug = 'pest';
insert into services (category_id, slug, name, subtitle, description, image_url, base_price, duration_mins, included, rating_avg, rating_count, display_order)
select id, 'hair', 'Haircut at Home', 'Cut, wash and style', 'Certified stylists bring sanitised kits and single-use capes.', 'https://images.unsplash.com/photo-1634449571010-02389ed0f9b0?q=80&w=600&auto=format&fit=crop', 399, 45, array['Consultation', 'Haircut and styling', 'Clean-up after service']::text[], 4.9, 1880, 9
from categories where slug = 'salon'
on conflict (slug) do update set category_id = excluded.category_id, name = excluded.name, subtitle = excluded.subtitle,
  description = excluded.description, image_url = excluded.image_url, base_price = excluded.base_price,
  duration_mins = excluded.duration_mins, included = excluded.included, rating_avg = excluded.rating_avg,
  rating_count = excluded.rating_count, display_order = excluded.display_order;
delete from service_packages where service_id = (select id from services where slug = 'hair');
delete from service_extras where service_id = (select id from services where slug = 'hair');
insert into service_packages (service_id, name, price, duration_mins, pros_count, includes, is_popular, display_order)
select s.id, v.* from services s, (values
  ('Basic', 399, 120, 1, array['Dusting and wiping', 'Floor mopping', 'Bin cleaning']::text[], false, 1),
  ('Standard', 539, 180, 2, array['Everything in Basic', 'Kitchen surfaces', 'Bathroom scrub']::text[], true, 2),
  ('Premium', 938, 240, 3, array['Everything in Standard', 'Machine scrubbing', 'Upholstery vacuum']::text[], false, 3)
) as v(name, price, duration_mins, pros_count, includes, is_popular, display_order) where s.slug = 'hair';
insert into services (category_id, slug, name, subtitle, description, image_url, base_price, duration_mins, included, rating_avg, rating_count, display_order)
select id, 'facial', 'Facial and Glow', 'Cleanse, mask, massage', 'Skin-type facial with branded products and a relaxing massage.', 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?q=80&w=600&auto=format&fit=crop', 699, 60, array['Skin analysis', 'Cleanse and scrub', 'Mask and massage']::text[], 4.8, 940, 10
from categories where slug = 'salon'
on conflict (slug) do update set category_id = excluded.category_id, name = excluded.name, subtitle = excluded.subtitle,
  description = excluded.description, image_url = excluded.image_url, base_price = excluded.base_price,
  duration_mins = excluded.duration_mins, included = excluded.included, rating_avg = excluded.rating_avg,
  rating_count = excluded.rating_count, display_order = excluded.display_order;
delete from service_packages where service_id = (select id from services where slug = 'facial');
delete from service_extras where service_id = (select id from services where slug = 'facial');
insert into service_packages (service_id, name, price, duration_mins, pros_count, includes, is_popular, display_order)
select s.id, v.* from services s, (values
  ('Basic', 699, 120, 1, array['Dusting and wiping', 'Floor mopping', 'Bin cleaning']::text[], false, 1),
  ('Standard', 944, 180, 2, array['Everything in Basic', 'Kitchen surfaces', 'Bathroom scrub']::text[], true, 2),
  ('Premium', 1643, 240, 3, array['Everything in Standard', 'Machine scrubbing', 'Upholstery vacuum']::text[], false, 3)
) as v(name, price, duration_mins, pros_count, includes, is_popular, display_order) where s.slug = 'facial';
insert into services (category_id, slug, name, subtitle, description, image_url, base_price, duration_mins, included, rating_avg, rating_count, display_order)
select id, 'carpentry', 'Furniture Assembly', 'Beds, wardrobes, desks', 'Assembly, hinge and drawer repair, and wall mounting.', 'https://images.unsplash.com/photo-1687422810663-c316494f725a?q=80&w=600&auto=format&fit=crop', 249, 90, array['Assembly or repair', 'Hardware fitting', 'Clean-up']::text[], 4.6, 410, 11
from categories where slug = 'carpentry'
on conflict (slug) do update set category_id = excluded.category_id, name = excluded.name, subtitle = excluded.subtitle,
  description = excluded.description, image_url = excluded.image_url, base_price = excluded.base_price,
  duration_mins = excluded.duration_mins, included = excluded.included, rating_avg = excluded.rating_avg,
  rating_count = excluded.rating_count, display_order = excluded.display_order;
delete from service_packages where service_id = (select id from services where slug = 'carpentry');
delete from service_extras where service_id = (select id from services where slug = 'carpentry');
insert into service_packages (service_id, name, price, duration_mins, pros_count, includes, is_popular, display_order)
select s.id, v.* from services s, (values
  ('Basic', 249, 120, 1, array['Dusting and wiping', 'Floor mopping', 'Bin cleaning']::text[], false, 1),
  ('Standard', 336, 180, 2, array['Everything in Basic', 'Kitchen surfaces', 'Bathroom scrub']::text[], true, 2),
  ('Premium', 585, 240, 3, array['Everything in Standard', 'Machine scrubbing', 'Upholstery vacuum']::text[], false, 3)
) as v(name, price, duration_mins, pros_count, includes, is_popular, display_order) where s.slug = 'carpentry';
insert into services (category_id, slug, name, subtitle, description, image_url, base_price, duration_mins, included, rating_avg, rating_count, display_order)
select id, 'appliance', 'Washing Machine Repair', 'All brands', 'Diagnosis and repair for front and top load machines.', 'https://images.unsplash.com/photo-1604335399105-a0c585fd81a1?q=80&w=600&auto=format&fit=crop', 299, 60, array['Diagnosis', 'Minor part replacement', '30-day warranty']::text[], 4.5, 520, 12
from categories where slug = 'appliance-repair'
on conflict (slug) do update set category_id = excluded.category_id, name = excluded.name, subtitle = excluded.subtitle,
  description = excluded.description, image_url = excluded.image_url, base_price = excluded.base_price,
  duration_mins = excluded.duration_mins, included = excluded.included, rating_avg = excluded.rating_avg,
  rating_count = excluded.rating_count, display_order = excluded.display_order;
delete from service_packages where service_id = (select id from services where slug = 'appliance');
delete from service_extras where service_id = (select id from services where slug = 'appliance');
insert into service_packages (service_id, name, price, duration_mins, pros_count, includes, is_popular, display_order)
select s.id, v.* from services s, (values
  ('Basic', 299, 120, 1, array['Dusting and wiping', 'Floor mopping', 'Bin cleaning']::text[], false, 1),
  ('Standard', 404, 180, 2, array['Everything in Basic', 'Kitchen surfaces', 'Bathroom scrub']::text[], true, 2),
  ('Premium', 703, 240, 3, array['Everything in Standard', 'Machine scrubbing', 'Upholstery vacuum']::text[], false, 3)
) as v(name, price, duration_mins, pros_count, includes, is_popular, display_order) where s.slug = 'appliance';
insert into services (category_id, slug, name, subtitle, description, image_url, base_price, duration_mins, included, rating_avg, rating_count, display_order)
select id, 'paint', 'Wall Painting', 'Single room refresh', 'Furniture covering, putty touch-up and two coats of premium emulsion.', 'https://images.unsplash.com/photo-1562259949-e8e7689d7828?q=80&w=600&auto=format&fit=crop', 1999, 480, array['Masking and covering', 'Putty touch-up', 'Two coats', 'Clean-up']::text[], 4.6, 212, 13
from categories where slug = 'painting'
on conflict (slug) do update set category_id = excluded.category_id, name = excluded.name, subtitle = excluded.subtitle,
  description = excluded.description, image_url = excluded.image_url, base_price = excluded.base_price,
  duration_mins = excluded.duration_mins, included = excluded.included, rating_avg = excluded.rating_avg,
  rating_count = excluded.rating_count, display_order = excluded.display_order;
delete from service_packages where service_id = (select id from services where slug = 'paint');
delete from service_extras where service_id = (select id from services where slug = 'paint');
insert into service_packages (service_id, name, price, duration_mins, pros_count, includes, is_popular, display_order)
select s.id, v.* from services s, (values
  ('Basic', 1999, 120, 1, array['Dusting and wiping', 'Floor mopping', 'Bin cleaning']::text[], false, 1),
  ('Standard', 2699, 180, 2, array['Everything in Basic', 'Kitchen surfaces', 'Bathroom scrub']::text[], true, 2),
  ('Premium', 4698, 240, 3, array['Everything in Standard', 'Machine scrubbing', 'Upholstery vacuum']::text[], false, 3)
) as v(name, price, duration_mins, pros_count, includes, is_popular, display_order) where s.slug = 'paint';
insert into services (category_id, slug, name, subtitle, description, image_url, base_price, duration_mins, included, rating_avg, rating_count, display_order)
select id, 'car', 'Car Wash at Home', 'Foam wash and vacuum', 'Waterless foam wash, tyre shine and interior vacuum at your parking spot.', 'https://images.unsplash.com/photo-1607860108855-64acf2078ed9?q=80&w=600&auto=format&fit=crop', 349, 45, array['Foam wash', 'Tyre shine', 'Interior vacuum', 'Dashboard wipe']::text[], 4.7, 690, 14
from categories where slug = 'car-care'
on conflict (slug) do update set category_id = excluded.category_id, name = excluded.name, subtitle = excluded.subtitle,
  description = excluded.description, image_url = excluded.image_url, base_price = excluded.base_price,
  duration_mins = excluded.duration_mins, included = excluded.included, rating_avg = excluded.rating_avg,
  rating_count = excluded.rating_count, display_order = excluded.display_order;
delete from service_packages where service_id = (select id from services where slug = 'car');
delete from service_extras where service_id = (select id from services where slug = 'car');
insert into service_packages (service_id, name, price, duration_mins, pros_count, includes, is_popular, display_order)
select s.id, v.* from services s, (values
  ('Basic', 349, 120, 1, array['Dusting and wiping', 'Floor mopping', 'Bin cleaning']::text[], false, 1),
  ('Standard', 471, 180, 2, array['Everything in Basic', 'Kitchen surfaces', 'Bathroom scrub']::text[], true, 2),
  ('Premium', 820, 240, 3, array['Everything in Standard', 'Machine scrubbing', 'Upholstery vacuum']::text[], false, 3)
) as v(name, price, duration_mins, pros_count, includes, is_popular, display_order) where s.slug = 'car';

-- Offers
insert into offers (code, title, description, kind, value, max_discount, min_order, category_id)
values ('SERWISH50', 'Flat 50% off', 'Up to ₹200 on your first booking', 'percent', 50, 200, null, null)
on conflict (code) do update set title = excluded.title, description = excluded.description, kind = excluded.kind,
  value = excluded.value, max_discount = excluded.max_discount, min_order = excluded.min_order, category_id = excluded.category_id;
insert into offers (code, title, description, kind, value, max_discount, min_order, category_id)
values ('CLEAN20', 'Flat 20% off', 'Minimum order ₹499', 'percent', 20, null, 499, (select id from categories where slug = 'cleaning'))
on conflict (code) do update set title = excluded.title, description = excluded.description, kind = excluded.kind,
  value = excluded.value, max_discount = excluded.max_discount, min_order = excluded.min_order, category_id = excluded.category_id;
insert into offers (code, title, description, kind, value, max_discount, min_order, category_id)
values ('PEST30', 'Flat 30% off', 'On pest control, up to ₹150', 'percent', 30, 150, null, (select id from categories where slug = 'pest-control'))
on conflict (code) do update set title = excluded.title, description = excluded.description, kind = excluded.kind,
  value = excluded.value, max_discount = excluded.max_discount, min_order = excluded.min_order, category_id = excluded.category_id;
insert into offers (code, title, description, kind, value, max_discount, min_order, category_id)
values ('FESTIVE100', 'Flat ₹100 off', 'On cleaning services', 'flat', 100, null, 299, (select id from categories where slug = 'cleaning'))
on conflict (code) do update set title = excluded.title, description = excluded.description, kind = excluded.kind,
  value = excluded.value, max_discount = excluded.max_discount, min_order = excluded.min_order, category_id = excluded.category_id;

-- Demo partners around Sector 56, Gurugram (28.4231, 77.1036)
insert into users (id, name, phone, photo_url, city) values ('seed_ravi', 'Ravi Kumar', '9000000001', 'https://images.unsplash.com/photo-1779281128550-8cc634361a17?q=80&w=300&auto=format&fit=crop', 'Gurugram')
on conflict (id) do update set name = excluded.name, photo_url = excluded.photo_url, city = excluded.city;
insert into provider_profiles (user_id, headline, service_areas, bio, years_experience, languages, hourly_rate, kyc_status, kyc_id_doc_path, kyc_cert_doc_path,
  kyc_submitted_at, kyc_reviewed_at, is_online, current_location, location_updated_at, rating_avg, rating_count, total_jobs)
values ('seed_ravi', 'Home Cleaning Expert', array['Sector 56', 'Sector 57', 'Sector 49', 'Sector 50', 'DLF Phase 1', 'DLF Phase 2', 'Sushant Lok', 'Golf Course Road']::text[], 'Hi, I''m Ravi! I specialize in home cleaning services with a focus on quality, safety and customer satisfaction.', 5, array['Hindi', 'English']::text[], 299, 'approved', 'seed/seed_ravi/id.jpg', 'seed/seed_ravi/cert.jpg',
  now(), now(), true, st_setsrid(st_makepoint(77.103600, 28.442019), 4326)::geography, now(), 4.8, 1248, 1240)
on conflict (user_id) do update set headline = excluded.headline, service_areas = excluded.service_areas, bio = excluded.bio, years_experience = excluded.years_experience, languages = excluded.languages,
  hourly_rate = excluded.hourly_rate, kyc_status = excluded.kyc_status, kyc_id_doc_path = excluded.kyc_id_doc_path,
  kyc_cert_doc_path = excluded.kyc_cert_doc_path, is_online = excluded.is_online, current_location = excluded.current_location,
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count, total_jobs = excluded.total_jobs;
insert into provider_categories (provider_id, category_id)
select 'seed_ravi', id from categories where slug in ('cleaning')
on conflict do nothing;
delete from provider_gallery where provider_id = 'seed_ravi';
insert into provider_gallery (provider_id, image_url) select 'seed_ravi', unnest(array['https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?q=80&w=400&auto=format&fit=crop', 'https://images.unsplash.com/photo-1560185893-a55cbc8c57e8?q=80&w=400&auto=format&fit=crop', 'https://images.unsplash.com/photo-1560185007-5f0bb1866cab?q=80&w=400&auto=format&fit=crop', 'https://images.unsplash.com/photo-1556911220-bff31c812dba?q=80&w=600&auto=format&fit=crop']::text[]);
insert into users (id, name, phone, photo_url, city) values ('seed_sunil', 'Sunil Sharma', '9000000002', 'https://images.unsplash.com/photo-1774437678715-fb40846dc252?q=80&w=300&auto=format&fit=crop', 'Gurugram')
on conflict (id) do update set name = excluded.name, photo_url = excluded.photo_url, city = excluded.city;
insert into provider_profiles (user_id, headline, service_areas, bio, years_experience, languages, hourly_rate, kyc_status, kyc_id_doc_path, kyc_cert_doc_path,
  kyc_submitted_at, kyc_reviewed_at, is_online, current_location, location_updated_at, rating_avg, rating_count, total_jobs)
values ('seed_sunil', 'AC and Appliance Technician', array['Sector 56', 'Sector 57', 'Sushant Lok']::text[], 'Certified technician for split and window ACs, washing machines and refrigerators.', 7, array['Hindi', 'English']::text[], 279, 'approved', 'seed/seed_sunil/id.jpg', 'seed/seed_sunil/cert.jpg',
  now(), now(), true, st_setsrid(st_makepoint(77.130830, 28.442198), 4326)::geography, now(), 4.7, 960, 980)
on conflict (user_id) do update set headline = excluded.headline, service_areas = excluded.service_areas, bio = excluded.bio, years_experience = excluded.years_experience, languages = excluded.languages,
  hourly_rate = excluded.hourly_rate, kyc_status = excluded.kyc_status, kyc_id_doc_path = excluded.kyc_id_doc_path,
  kyc_cert_doc_path = excluded.kyc_cert_doc_path, is_online = excluded.is_online, current_location = excluded.current_location,
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count, total_jobs = excluded.total_jobs;
insert into provider_categories (provider_id, category_id)
select 'seed_sunil', id from categories where slug in ('ac-service', 'appliance-repair', 'cleaning')
on conflict do nothing;
delete from provider_gallery where provider_id = 'seed_sunil';
insert into provider_gallery (provider_id, image_url) select 'seed_sunil', unnest(array['https://images.unsplash.com/photo-1759772238012-9d5ad59ae637?q=80&w=600&auto=format&fit=crop', 'https://images.unsplash.com/photo-1604335399105-a0c585fd81a1?q=80&w=600&auto=format&fit=crop']::text[]);
insert into users (id, name, phone, photo_url, city) values ('seed_amit', 'Amit Yadav', '9000000003', 'https://images.unsplash.com/photo-1774437676976-655ad890b6ff?q=80&w=300&auto=format&fit=crop', 'Gurugram')
on conflict (id) do update set name = excluded.name, photo_url = excluded.photo_url, city = excluded.city;
insert into provider_profiles (user_id, headline, service_areas, bio, years_experience, languages, hourly_rate, kyc_status, kyc_id_doc_path, kyc_cert_doc_path,
  kyc_submitted_at, kyc_reviewed_at, is_online, current_location, location_updated_at, rating_avg, rating_count, total_jobs)
values ('seed_amit', 'Plumbing and Electrical', array['Sector 49', 'Sector 50', 'Golf Course Road']::text[], 'Quick fixes for leaks, wiring and fittings, with a 30-day warranty on every repair.', 6, array['Hindi']::text[], 259, 'approved', 'seed/seed_amit/id.jpg', 'seed/seed_amit/cert.jpg',
  now(), now(), true, st_setsrid(st_makepoint(77.144547, 28.414881), 4326)::geography, now(), 4.6, 842, 860)
on conflict (user_id) do update set headline = excluded.headline, service_areas = excluded.service_areas, bio = excluded.bio, years_experience = excluded.years_experience, languages = excluded.languages,
  hourly_rate = excluded.hourly_rate, kyc_status = excluded.kyc_status, kyc_id_doc_path = excluded.kyc_id_doc_path,
  kyc_cert_doc_path = excluded.kyc_cert_doc_path, is_online = excluded.is_online, current_location = excluded.current_location,
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count, total_jobs = excluded.total_jobs;
insert into provider_categories (provider_id, category_id)
select 'seed_amit', id from categories where slug in ('plumbing', 'electrician', 'cleaning')
on conflict do nothing;
delete from provider_gallery where provider_id = 'seed_amit';
insert into provider_gallery (provider_id, image_url) select 'seed_amit', unnest(array['https://images.unsplash.com/photo-1676210133055-eab6ef033ce3?q=80&w=600&auto=format&fit=crop', 'https://images.unsplash.com/photo-1660330589693-99889d60181e?q=80&w=600&auto=format&fit=crop']::text[]);
insert into users (id, name, phone, photo_url, city) values ('seed_deepak', 'Deepak Singh', '9000000004', 'https://images.unsplash.com/photo-1778692258270-bc0e80e975c0?q=80&w=300&auto=format&fit=crop', 'Gurugram')
on conflict (id) do update set name = excluded.name, photo_url = excluded.photo_url, city = excluded.city;
insert into provider_profiles (user_id, headline, service_areas, bio, years_experience, languages, hourly_rate, kyc_status, kyc_id_doc_path, kyc_cert_doc_path,
  kyc_submitted_at, kyc_reviewed_at, is_online, current_location, location_updated_at, rating_avg, rating_count, total_jobs)
values ('seed_deepak', 'Deep Cleaning Specialist', array['DLF Phase 1', 'DLF Phase 2', 'Sector 56']::text[], 'Machine scrubbing and sofa shampoo are my speciality. Every job ends with a walk-through.', 4, array['Hindi', 'Punjabi']::text[], 299, 'approved', 'seed/seed_deepak/id.jpg', 'seed/seed_deepak/cert.jpg',
  now(), now(), false, st_setsrid(st_makepoint(77.126712, 28.380892), 4326)::geography, now(), 4.6, 720, 742)
on conflict (user_id) do update set headline = excluded.headline, service_areas = excluded.service_areas, bio = excluded.bio, years_experience = excluded.years_experience, languages = excluded.languages,
  hourly_rate = excluded.hourly_rate, kyc_status = excluded.kyc_status, kyc_id_doc_path = excluded.kyc_id_doc_path,
  kyc_cert_doc_path = excluded.kyc_cert_doc_path, is_online = excluded.is_online, current_location = excluded.current_location,
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count, total_jobs = excluded.total_jobs;
insert into provider_categories (provider_id, category_id)
select 'seed_deepak', id from categories where slug in ('cleaning', 'pest-control')
on conflict do nothing;
delete from provider_gallery where provider_id = 'seed_deepak';
insert into provider_gallery (provider_id, image_url) select 'seed_deepak', unnest(array['https://images.unsplash.com/photo-1686178827149-6d55c72d81df?q=80&w=600&auto=format&fit=crop', 'https://images.unsplash.com/photo-1560185007-5f0bb1866cab?q=80&w=400&auto=format&fit=crop']::text[]);
insert into users (id, name, phone, photo_url, city) values ('seed_manoj', 'Manoj Patel', '9000000005', 'https://images.unsplash.com/photo-1774437678715-fb40846dc252?q=80&w=300&auto=format&fit=crop', 'Gurugram')
on conflict (id) do update set name = excluded.name, photo_url = excluded.photo_url, city = excluded.city;
insert into provider_profiles (user_id, headline, service_areas, bio, years_experience, languages, hourly_rate, kyc_status, kyc_id_doc_path, kyc_cert_doc_path,
  kyc_submitted_at, kyc_reviewed_at, is_online, current_location, location_updated_at, rating_avg, rating_count, total_jobs)
values ('seed_manoj', 'Carpenter and Painter', array['Sector 57', 'Sushant Lok']::text[], 'Furniture assembly, repairs and room painting with clean-up included.', 9, array['Hindi', 'Gujarati']::text[], 249, 'approved', 'seed/seed_manoj/id.jpg', 'seed/seed_manoj/cert.jpg',
  now(), now(), true, st_setsrid(st_makepoint(77.076932, 28.374399), 4326)::geography, now(), 4.5, 655, 690)
on conflict (user_id) do update set headline = excluded.headline, service_areas = excluded.service_areas, bio = excluded.bio, years_experience = excluded.years_experience, languages = excluded.languages,
  hourly_rate = excluded.hourly_rate, kyc_status = excluded.kyc_status, kyc_id_doc_path = excluded.kyc_id_doc_path,
  kyc_cert_doc_path = excluded.kyc_cert_doc_path, is_online = excluded.is_online, current_location = excluded.current_location,
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count, total_jobs = excluded.total_jobs;
insert into provider_categories (provider_id, category_id)
select 'seed_manoj', id from categories where slug in ('carpentry', 'painting', 'cleaning')
on conflict do nothing;
delete from provider_gallery where provider_id = 'seed_manoj';
insert into provider_gallery (provider_id, image_url) select 'seed_manoj', unnest(array['https://images.unsplash.com/photo-1687422810663-c316494f725a?q=80&w=600&auto=format&fit=crop', 'https://images.unsplash.com/photo-1562259949-e8e7689d7828?q=80&w=600&auto=format&fit=crop']::text[]);
insert into users (id, name, phone, photo_url, city) values ('seed_priya', 'Priya Sharma', '9000000006', 'https://images.unsplash.com/photo-1759840278381-bf7d5e332050?q=80&w=300&auto=format&fit=crop', 'Gurugram')
on conflict (id) do update set name = excluded.name, photo_url = excluded.photo_url, city = excluded.city;
insert into provider_profiles (user_id, headline, service_areas, bio, years_experience, languages, hourly_rate, kyc_status, kyc_id_doc_path, kyc_cert_doc_path,
  kyc_submitted_at, kyc_reviewed_at, is_online, current_location, location_updated_at, rating_avg, rating_count, total_jobs)
values ('seed_priya', 'Beauty and Hair Stylist', array['Sector 56', 'DLF Phase 1', 'Golf Course Road']::text[], 'Salon-trained stylist bringing sanitised kits for haircuts, facials and grooming.', 6, array['Hindi', 'English', 'Bengali']::text[], 399, 'approved', 'seed/seed_priya/id.jpg', 'seed/seed_priya/cert.jpg',
  now(), now(), true, st_setsrid(st_makepoint(77.075636, 28.417487), 4326)::geography, now(), 4.9, 1090, 1100)
on conflict (user_id) do update set headline = excluded.headline, service_areas = excluded.service_areas, bio = excluded.bio, years_experience = excluded.years_experience, languages = excluded.languages,
  hourly_rate = excluded.hourly_rate, kyc_status = excluded.kyc_status, kyc_id_doc_path = excluded.kyc_id_doc_path,
  kyc_cert_doc_path = excluded.kyc_cert_doc_path, is_online = excluded.is_online, current_location = excluded.current_location,
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count, total_jobs = excluded.total_jobs;
insert into provider_categories (provider_id, category_id)
select 'seed_priya', id from categories where slug in ('salon')
on conflict do nothing;
delete from provider_gallery where provider_id = 'seed_priya';
insert into provider_gallery (provider_id, image_url) select 'seed_priya', unnest(array['https://images.unsplash.com/photo-1634449571010-02389ed0f9b0?q=80&w=600&auto=format&fit=crop', 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?q=80&w=600&auto=format&fit=crop']::text[]);
insert into users (id, name, phone, photo_url, city) values ('seed_neha', 'Neha Singh', '9000000007', 'https://images.unsplash.com/photo-1759840278361-f1adc75529a1?q=80&w=300&auto=format&fit=crop', 'Gurugram')
on conflict (id) do update set name = excluded.name, photo_url = excluded.photo_url, city = excluded.city;
insert into provider_profiles (user_id, headline, service_areas, bio, years_experience, languages, hourly_rate, kyc_status, kyc_id_doc_path, kyc_cert_doc_path,
  kyc_submitted_at, kyc_reviewed_at, is_online, current_location, location_updated_at, rating_avg, rating_count, total_jobs)
values ('seed_neha', 'Car Care and Cleaning', array['Sector 49', 'Sector 50']::text[], 'Doorstep car wash and home cleaning with eco-friendly products.', 3, array['Hindi', 'English']::text[], 269, 'approved', 'seed/seed_neha/id.jpg', 'seed/seed_neha/cert.jpg',
  now(), now(), true, st_setsrid(st_makepoint(77.072365, 28.445006), 4326)::geography, now(), 4.7, 505, 520)
on conflict (user_id) do update set headline = excluded.headline, service_areas = excluded.service_areas, bio = excluded.bio, years_experience = excluded.years_experience, languages = excluded.languages,
  hourly_rate = excluded.hourly_rate, kyc_status = excluded.kyc_status, kyc_id_doc_path = excluded.kyc_id_doc_path,
  kyc_cert_doc_path = excluded.kyc_cert_doc_path, is_online = excluded.is_online, current_location = excluded.current_location,
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count, total_jobs = excluded.total_jobs;
insert into provider_categories (provider_id, category_id)
select 'seed_neha', id from categories where slug in ('car-care', 'cleaning')
on conflict do nothing;
delete from provider_gallery where provider_id = 'seed_neha';
insert into provider_gallery (provider_id, image_url) select 'seed_neha', unnest(array['https://images.unsplash.com/photo-1607860108855-64acf2078ed9?q=80&w=600&auto=format&fit=crop', 'https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?q=80&w=400&auto=format&fit=crop']::text[]);

-- First-booking-only coupons (Phase 3 migration adds the column)
update offers set first_booking_only = true where code = 'SERWISH50';
