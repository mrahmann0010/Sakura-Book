import type { Metadata } from "next";
import Image, { type StaticImageData } from "next/image";
import type { ReactNode } from "react";

import { AppNav, PageHeader, PageShell, Shell } from "@/components/layout";
import { LinkButton } from "@/components/ui";
import type { Locale } from "@/i18n/settings";

import { CopyField } from "./copy-field";
import step1 from "./step-1.jpg";
import step2 from "./step-2.jpg";
import step3 from "./step-3.jpg";

/* --------------------------------------------------------------------------
   Coupon guide

   A self-contained how-to for shoppers who were sent a coupon code: open the
   coupon checkout, pick books, apply the code, pay. Everything it shows lives
   in this folder — the Bangla copy below and the three phone screenshots
   beside this file — so it reads the same under every locale prefix and does
   not depend on the shared translations.
   -------------------------------------------------------------------------- */

const couponCode = "MOCK-12-26";
const checkoutDisplay = "books.nihonovaacademy.com/bn/checkout/coupon";
const whatsappNumber = "01350-302733";
const whatsappHref = "https://wa.me/8801350302733";

export const metadata: Metadata = {
  title: "কুপন দিয়ে অর্ডার করার নিয়ম",
  description: "তিনটি ধাপে কুপন কোড ব্যবহার করে Nihonova Books থেকে বই অর্ডার করুন।",
};

type Step = {
  number: string;
  title: string;
  image: StaticImageData;
  alt: string;
  body: ReactNode;
  tip?: ReactNode;
};

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="bg-tint text-ink rounded-xs px-1.5 py-0.5 font-mono text-[0.92em] font-semibold">
      {children}
    </kbd>
  );
}

const steps: Step[] = [
  {
    number: "১",
    title: "লিংকটি খুলুন",
    image: step1,
    alt: "চেকআউট পেজ: 'আপনার বই বেছে নিন' কার্ডে 'বই বেছে নিন' বাটন",
    body: (
      <>
        লিংকে গেলে <strong>চেকআউট</strong> পেজ খুলবে। “আপনার বই বেছে নিন” কার্ডে{" "}
        <strong>বই বেছে নিন</strong> বাটনে ট্যাপ করুন।
      </>
    ),
  },
  {
    number: "২",
    title: "বই বাছাই করুন",
    image: step2,
    alt: "বইয়ের তালিকা: কয়েকটি বইয়ে 'যোগ হয়েছে ✓', নিচে 'হয়ে গেছে — ২টি বই বাছাই করা হয়েছে' বাটন",
    body: (
      <>
        যে বই নিতে চান তার পাশে <strong>যোগ করুন</strong> চাপুন, পাশে “যোগ হয়েছে ✓” দেখাবে।
        প্রি-অর্ডারের বইও এখানে আছে। শেষ হলে নিচের <strong>হয়ে গেছে</strong> বাটনে ট্যাপ করুন।
      </>
    ),
    tip: (
      <>
        পরিমাণ পরে চেকআউটে <Key>−</Key> <Key>+</Key> দিয়ে বদলানো যাবে।
      </>
    ),
  },
  {
    number: "৩",
    title: "কুপন বসিয়ে অর্ডার দিন",
    image: step3,
    alt: "চেকআউট: কুপন কোড ঘরে MOCK-12-26, পাশে 'প্রয়োগ করুন', নিচে ডেলিভারির তথ্য ও 'পেমেন্টে যান'",
    body: (
      <>
        <strong>কুপন কোড</strong> ঘরে <Key>{couponCode}</Key> লিখে <strong>প্রয়োগ করুন</strong>{" "}
        চাপুন। তারপর পুরো নাম, ইমেইল ও ঠিকানা দিয়ে <strong>পেমেন্টে যান</strong> চাপুন।
      </>
    ),
    tip: (
      <>
        ভুল বই যোগ হলে তার নিচের <strong>সরান</strong> চাপলেই বাদ যাবে।
      </>
    ),
  },
];

export default async function CouponGuidePage({ params }: PageProps<"/[locale]/coupon-guide">) {
  const { locale } = (await params) as { locale: Locale };

  return (
    <PageShell header={<AppNav brandHref={`/${locale}`} />}>
      <Shell className="flex flex-col gap-14 py-14 lg:gap-20 lg:py-20">
        <PageHeader
          eyebrow="Nihonova Books · কুপন গাইড"
          title="কুপন দিয়ে কীভাবে অর্ডার করবেন"
          description="নিচের ধাপগুলো অনুসরণ করুন: বই বেছে নিন, কুপন কোড বসান, তারপর ডেলিভারির তথ্য দিয়ে পেমেন্ট করুন।"
          size="md"
        />

        <ol className="grid grid-cols-[repeat(auto-fit,minmax(min(18rem,100%),1fr))] gap-x-8 gap-y-12">
          {steps.map((step) => (
            <li key={step.number} className="flex min-w-0 flex-col gap-5">
              <Image
                src={step.image}
                alt={step.alt}
                sizes="(min-width: 1024px) 300px, 80vw"
                className="w-full max-w-75 self-center rounded-[28px]"
              />
              <div>
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="bg-clay text-surface flex size-9 shrink-0 items-center justify-center rounded-full text-lg font-semibold"
                  >
                    {step.number}
                  </span>
                  <h2 className="text-ink font-serif text-2xl leading-snug">{step.title}</h2>
                </div>
                <p className="text-body mt-2.5">{step.body}</p>
                {step.tip ? <p className="text-caption text-muted mt-2">{step.tip}</p> : null}
              </div>
            </li>
          ))}
        </ol>

        <section className="border-rule bg-surface rounded-container flex max-w-xl min-w-0 flex-col gap-5 border p-5 sm:p-6">
          <h2 className="text-ink font-serif text-2xl leading-snug">
            এখন কোডটি কপি করে লিংক থেকে অর্ডার করুন
          </h2>
          <div className="flex flex-col gap-2">
            <CopyField label="কুপন কোড" value={couponCode} mono />
            <p className="text-caption text-muted">কোডটি হুবহু লিখুন, মাঝের হাইফেনসহ।</p>
          </div>
          <div className="flex flex-col gap-2">
            <LinkButton href={`/${locale}/checkout/coupon`} size="lg" block>
              অর্ডার করতে এখানে চাপুন →
            </LinkButton>
            <p className="text-caption text-muted wrap-anywhere text-center">{checkoutDisplay}</p>
          </div>
        </section>

        <footer className="border-rule flex flex-col gap-5 border-t pt-8">
          <div className="max-w-lg">
            <CopyField
              label="সাহায্য লাগলে WhatsApp-এ মেসেজ দিন"
              value={whatsappNumber}
              href={whatsappHref}
            />
          </div>
          <p className="text-caption text-muted">
            শুধু বাংলাদেশের ভেতরে ডেলিভারি। পেমেন্ট করা যাবে bKash, Rocket বা Nagad দিয়ে।
          </p>
        </footer>
      </Shell>
    </PageShell>
  );
}
