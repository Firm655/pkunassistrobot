import { PageHeader, Card } from '@/components/ui';
import { CareCalendar } from '@/features/calendar/CareCalendar';

export default function CalendarPage() {
  return (
    <>
      <PageHeader title="Calendar" subtitle="All patients' care schedules. Click a day to add an event, or an event to view and edit it." />
      <Card><CareCalendar /></Card>
    </>
  );
}
