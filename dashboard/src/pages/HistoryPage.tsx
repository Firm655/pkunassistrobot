import { PageHeader } from '@/components/ui';
import { HistoryView } from '@/features/history/HistoryView';

export default function HistoryPage() {
  return (
    <>
      <PageHeader title="History" subtitle="Responses, messages, patient requests and alerts." />
      <HistoryView />
    </>
  );
}
