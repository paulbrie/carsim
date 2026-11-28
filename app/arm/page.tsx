import { ArmPage } from '@/components/arm-page';

export const metadata = {
  title: 'The arm (preview)',
  description: 'A second simulator, in preview: two arms with two-finger grippers (a desk arm, and Seeed Studio’s reBot Arm B601-RS), and tiny neural networks that learn to pick a cube up, put it in a tray, stack four. Watch one, try it by hand, train your own in the browser.',
};
export const dynamic = 'force-dynamic';

// The arm sim (#359) is a preview: one page, not in the top bar yet (components/arm-page.tsx); a saved network's link is
// /arm/<id> (#364, app/arm/[id]/page.tsx).
export default function Arm() {
  return <ArmPage />;
}
