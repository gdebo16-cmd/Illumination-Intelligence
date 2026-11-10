import Image from 'next/image';
import Link from 'next/link';
import { getApp } from '@/config/apps';

// An app's banner in the header. The picture itself ignores clicks (it is wide and mostly
// empty); the link sits over the symbol and name in the middle and opens that app's first page.
const AppBanner = ({ appId }: { appId: string }) => {
  const app = getApp(appId);
  return (
    <>
      <Image src={app.banner} alt="" width={2560} height={300} className="banner" priority />
      <Link href={app.href} className="banner-link" aria-label={`${app.name} home`} title={app.name} />
    </>
  );
};

export default AppBanner;
