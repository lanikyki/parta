import { Reveal } from '@/components/Reveal';
import { Audience } from '@/components/landing/Audience';
import { Faq } from '@/components/landing/Faq';
import { Features } from '@/components/landing/Features';
import { Footer } from '@/components/landing/Footer';
import { Header } from '@/components/landing/Header';
import { Hero } from '@/components/landing/Hero';
import { Lead } from '@/components/landing/Lead';
import { Steps } from '@/components/landing/Steps';
import { Subjects } from '@/components/landing/Subjects';
import { Tutors } from '@/components/landing/Tutors';
import { getUser } from '@/lib/auth';

export default async function Home() {
  const user = await getUser().catch(() => null);
  const loggedIn = Boolean(user);
  return (
    <>
      <Header loggedIn={loggedIn} />
      <main>
        <Hero loggedIn={loggedIn} />
        <Features />
        <Audience />
        <Steps />
        <Tutors />
        <Subjects />
        <Faq />
        <Lead loggedIn={loggedIn} />
      </main>
      <Footer />
      <Reveal />
    </>
  );
}
