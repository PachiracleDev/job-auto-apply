import { Readability } from "@mozilla/readability";
import { DOMParser } from "linkedom";

export interface ExtractedArticle {
  title: string;
  textContent: string;
}

export function extractArticleFromHtml(html: string): ExtractedArticle | null {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const article = new Readability(doc as unknown as Document).parse();
    if (!article) {
      return null;
    }
    const title = article.title?.trim() ?? "";
    const textContent = article.textContent?.trim() ?? "";
    if (!textContent) {
      return null;
    }
    return { title, textContent };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    throw new Error(`extractArticleFromHtml: ${err.message}`);
  }
}
