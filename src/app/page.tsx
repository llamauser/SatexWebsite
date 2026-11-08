import { BlobBackground } from "@/components/layout/BlobBackground";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

// Temporary scaffold page (P1-01). The real home page is built in P1-06.
export default function Home() {
  return (
    <>
      <BlobBackground />
      <Header />
      <main className="mx-auto flex min-h-[70vh] max-w-[1200px] flex-col items-center justify-center px-4 text-center">
        <h1 className="font-display text-[clamp(36px,5vw,64px)] font-bold leading-tight">
          Stop guessing.
        </h1>
        <p className="mt-2 font-display text-2xl font-semibold sm:text-3xl">
          Let AI find your <span className="text-primary">fabric</span> in seconds.
        </p>
      </main>
      <Footer />
    </>
  );
}
