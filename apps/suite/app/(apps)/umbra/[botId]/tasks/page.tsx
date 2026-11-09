'use client';

import { useParams } from 'next/navigation';
import BotTasks from '../../_components/BotTasks';

export default function BotTasksPage() {
  const { botId } = useParams<{ botId: string }>();
  return <BotTasks key={botId} botId={botId} />;
}
