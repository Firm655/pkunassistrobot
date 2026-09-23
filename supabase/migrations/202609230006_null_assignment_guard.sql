-- Null is not an assignment. Guard before any device message update.
create or replace function public.acknowledge_message(message_id uuid, patient_id uuid, acknowledged boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.devices; m public.messages;
begin
  d := private.require_device(patient_id);
  select * into m from public.messages where id = message_id for update;
  if m.id is null or m.patient_id is distinct from patient_id or m.sender_type <> 'CARETAKER' then
    raise exception 'Message not available' using errcode = '42501';
  end if;
  update public.messages set delivered_at = coalesce(delivered_at,now()),
    acknowledged_at = case when acknowledged then coalesce(acknowledged_at,now()) else acknowledged_at end where id = message_id;
  if acknowledged and m.acknowledged_at is null then
    insert into public.interaction_logs(organization_id,patient_id,device_id,action,data)
      values(d.organization_id,patient_id,d.id,'MESSAGE_ACKNOWLEDGED',jsonb_build_object('message_id',message_id));
  end if;
end $$;
