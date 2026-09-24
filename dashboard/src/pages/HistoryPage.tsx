import { PageHeader } from '@/components/ui';
import { HistoryView } from '@/features/history/HistoryView';

export default function HistoryPage() {
  return (
    <>
      <PageHeader title="History" subtitle="Care activity, patient responses, requests and alerts." />
      <HistoryView />
    </>
  );
}
