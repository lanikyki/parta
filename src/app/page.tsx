import { Reveal } from '@/components/Reveal';
import { Audience } from '@/components/landing/Audience';
import { Faq } from '@/components/landing/Faq';
import { Features } from '@/components/landing/Features';
import { Footer } from '@/components/landing/Footer';
import { Header } from '@/components/landing/Header';
import { Hero } from '@/components/landing/Hero';
import { Lead } from '@/components/landing/Lead';
import { Pricing } from '@/components/landing/Pricing';
import { RefBanner } from '@/components/landing/RefBanner';
import { Steps } from '@/components/landing/Steps';
import { Subjects } from '@/components/landing/Subjects';
import { Tutors } from '@/components/landing/Tutors';
import { getUser } from '@/lib/auth';
import { refFromCookie } from '@/lib/referral';

export default async function Home() {
  const user = await getUser().catch(() => null);
  const loggedIn = Boolean(user);
  // Пришли по ссылке коллеги (/r/код) — показываем, кто пригласил, и скидку
  const ref = loggedIn ? null : await refFromCookie().catch(() => null);
  return (
    <>
      <Header loggedIn={loggedIn} />
      <main>
        {ref && <RefBanner name={ref.name} />}
        <Hero loggedIn={loggedIn} />
        <Features />
        <Audience />
        <Steps />
        <Tutors />
        <Subjects />
        <Pricing loggedIn={loggedIn} />
        <Faq />
        <Lead loggedIn={loggedIn} />
      </main>
      <Footer />
      <Reveal />
    </>
  );
}
