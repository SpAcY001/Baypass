"use client";

import dynamic from "next/dynamic";

const TransitMap = dynamic(() => import("@/components/TransitMap"), {
  ssr: false,
  loading: () => <div className="h-dvh w-full bg-[#e8e4dc]" />,
});

export default function MapApp() {
  return <TransitMap />;
}
