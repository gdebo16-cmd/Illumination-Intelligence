'use client';

import { useParams } from 'next/navigation';
import BotChat from '../_components/BotChat';

export default function BotChatPage() {
  const { botId } = useParams<{ botId: string }>();
  return <BotChat key={botId} botId={botId} />;
}
