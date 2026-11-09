'use client';

import { useParams } from 'next/navigation';
import BotForm from '../../_components/BotForm';

export default function EditBotPage() {
  const { botId } = useParams<{ botId: string }>();
  return <BotForm key={botId} botId={botId} />;
}
