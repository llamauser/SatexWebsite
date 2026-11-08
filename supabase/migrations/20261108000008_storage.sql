-- P1-03 / 8: storage buckets and policies. Spec: docs/04-database.md §Storage buckets.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('fabric-images', 'fabric-images', true,  10485760, array['image/webp','image/jpeg','image/png','image/avif']),
  ('textures',      'textures',      true,  20971520, array['image/webp','image/png','image/ktx2','application/octet-stream']),
  ('models',        'models',        true,  52428800, array['model/gltf-binary','model/gltf+json','application/octet-stream']),
  ('brand',         'brand',         true,   5242880, array['image/webp','image/jpeg','image/png','image/svg+xml']),
  ('quote-pdfs',    'quote-pdfs',    false, 10485760, array['application/pdf']),
  ('snap-uploads',  'snap-uploads',  false,  8388608, array['image/webp','image/jpeg','image/png'])
on conflict (id) do nothing;

-- public buckets: anyone can read (public URL); only admins write
create policy "public buckets: admin write" on storage.objects for all to authenticated
  using (bucket_id in ('fabric-images','textures','models','brand') and public.is_admin())
  with check (bucket_id in ('fabric-images','textures','models','brand') and public.is_admin());

-- quote PDFs live at quotes/{quote_id}/r{revision}.pdf : readable by staff and by the owning client; written by the server only
create policy "quote pdfs: owner or staff read" on storage.objects for select to authenticated
  using (
    bucket_id = 'quote-pdfs' and (
      public.is_staff() or exists (
        select 1 from public.quotes q
         where q.id::text = split_part(name, '/', 2) and q.client_id = public.my_client_id())));
-- snap-uploads: no policy (service role only)
