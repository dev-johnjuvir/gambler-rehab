import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Scatter Pinas Slot Machine",
  description: "Paldo ka dito sa Scatter Pinas, isang slot machine na may temang Pilipino. Maglaro at mag-enjoy sa makulay na mundo ng mga simbolo at tunog ng Pilipinas!",
};

type FullGamblingLayoutProps = {
  children: ReactNode;
};

export default function FullGamblingLayout({ children }: FullGamblingLayoutProps) {
  return children;
}
