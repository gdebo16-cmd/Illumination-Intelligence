import Image from 'next/image';
import Link from 'next/link';
import { getApp } from '@/config/apps';

// An app's symbol and name, floating in the top-right corner over the page. The picture is Art's
// see-through cutout (public/brand/cutouts/<id>.png); tapping it opens that app's first page.
// Bump when any cutout picture changes, so phones don't keep showing a cached old one.
const BRAND_VERSION = '2';

const AppBanner = ({ appId }: { appId: string }) => {
  const app = getApp(appId);
  return (
    <Link href={app.href} className="banner-corner" aria-label={`${app.name} home`} title={app.name}>
      <Image src={`/brand/cutouts/${appId}.png?v=${BRAND_VERSION}`} alt="" width={1600} height={680} className="banner-cutout" priority />
    </Link>
  );
};

export default AppBanner;