import { PageHeader, Card } from '@/components/ui';
import { CareCalendar } from '@/features/calendar/CareCalendar';

export default function CalendarPage() {
  return (
    <>
      <PageHeader title="Calendar" subtitle="Care schedules across your team" />
      <Card><CareCalendar /></Card>
    </>
  );
}
