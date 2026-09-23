begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('patient-photos','patient-photos',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;

create policy pkun_photo_read on storage.objects for select to authenticated using (
  bucket_id = 'patient-photos' and exists(
    select 1 from public.profiles p where p.id = (select auth.uid())
      and p.organization_id::text = (storage.foldername(name))[1]
  )
);
create policy pkun_photo_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'patient-photos' and exists(
    select 1 from public.patients p where p.organization_id::text = (storage.foldername(name))[1]
      and p.id::text = (storage.foldername(name))[2] and private.is_staff(p.organization_id)
  )
);
create policy pkun_photo_update on storage.objects for update to authenticated using (
  bucket_id = 'patient-photos' and exists(
    select 1 from public.profiles p where p.id = (select auth.uid())
      and p.organization_id::text = (storage.foldername(name))[1]
  )
) with check (
  bucket_id = 'patient-photos' and exists(
    select 1 from public.patients p where p.organization_id::text = (storage.foldername(name))[1]
      and p.id::text = (storage.foldername(name))[2] and private.is_staff(p.organization_id)
  )
);
commit;
