import type { Metadata } from 'next';
import { ExamplePortfolioExplorer } from '@/components/example-portfolio-explorer';
import { examplePortfolio } from '@/lib/example-portfolio';

export const metadata: Metadata = { title: 'Example portfolio · Global Portfolio Intelligence' };

export default function ExamplePortfolioPage() {
  return <ExamplePortfolioExplorer portfolio={examplePortfolio} />;
}
