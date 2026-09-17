import { BannerSlider } from "@/components/blocks/BannerSlider";
import { CategoryRows } from "@/components/blocks/CategoryRows";
import { Collection } from "@/components/blocks/Collection";
import { Downloads } from "@/components/blocks/Downloads";
import { Embed } from "@/components/blocks/Embed";
import { Enquiry } from "@/components/blocks/Enquiry";
import { Faq } from "@/components/blocks/Faq";
import { FeatureList } from "@/components/blocks/FeatureList";
import { IconBanner } from "@/components/blocks/IconBanner";
import { Notice } from "@/components/blocks/Notice";
import { RichText } from "@/components/blocks/RichText";
import { SubscribeSection } from "@/components/blocks/SubscribeSection";
import { TextImage } from "@/components/blocks/TextImage";
import type { Block } from "@/lib/blocks/types";

interface RendererProps {
  blocks: Block[];
  basePath: string;
  currency?: string;
}

/**
 * Turns a list of blocks into a page.
 *
 * The switch is exhaustive on purpose: TypeScript fails the build if a block
 * type is added to the union and not handled here, which is the cheapest
 * possible guard against a CMS shipping a block the site silently drops.
 *
 * Blocks that need data fetch it themselves. That keeps this file free of
 * per-block plumbing and means a slow carousel does not hold up the hero.
 */
export function Renderer({ blocks, basePath, currency }: RendererProps) {
  return (
    <>
      {blocks.map((block, index) => {
        // Blocks have no ids yet; the CMS will supply them. Index plus type is
        // stable for a server-rendered list that never reorders on the client.
        const key = `${block.type}-${index}`;

        switch (block.type) {
          case "text_image":
            return <TextImage key={key} {...block} basePath={basePath} />;
          case "banner_slider":
            // basePath, because his Part 2 hero carries two buttons and an
            // internal link without it points at /products rather than
            // /nz/en/products. It reads right in a screenshot and is wrong on
            // the click, which is the same fault the FeatureList buttons had.
            return <BannerSlider key={key} {...block} basePath={basePath} />;
          case "icon_banner":
            return <IconBanner key={key} {...block} />;
          case "category_rows":
            return (
              <CategoryRows
                key={key}
                {...block}
                basePath={basePath}
                currency={currency}
              />
            );
          case "collection":
            return (
              <Collection
                key={key}
                {...block}
                basePath={basePath}
                currency={currency}
              />
            );
          case "notice":
            return <Notice key={key} {...block} />;
          case "rich_text":
            return <RichText key={key} {...block} />;
          case "faq":
            return <Faq key={key} {...block} />;
          case "enquiry":
            return <Enquiry key={key} {...block} basePath={basePath} />;
          case "subscribe":
            // The wrapper, not the form: it resolves this shop's own policy
            // links server side and hands them to the client component.
            return (
              <SubscribeSection key={key} {...block} basePath={basePath} />
            );
          case "downloads":
            return <Downloads key={key} {...block} />;
          case "embed":
            return <Embed key={key} {...block} />;
          case "feature_list":
            return <FeatureList key={key} {...block} basePath={basePath} />;
          default: {
            // The comment above promised the switch was exhaustive and it was
            // not: a `default: return null` meant any block type added to the
            // union and not handled here rendered as nothing, silently, which
            // is the failure this file claimed to prevent. This makes the
            // promise real, and costs nothing at runtime.
            const unhandled: never = block;
            void unhandled;
            return null;
          }
        }
      })}
    </>
  );
}
