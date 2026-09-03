import { Mark, mergeAttributes } from "@tiptap/core";

export interface WikiLinkOptions {
  HTMLAttributes: Record<string, unknown>;
  onOpen?: (title: string) => void;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    wikiLink: {
      setWikiLink: (title: string) => ReturnType;
    };
  }
}

export const WikiLink = Mark.create<WikiLinkOptions>({
  name: "wikiLink",

  inclusive: false,

  addOptions() {
    return {
      HTMLAttributes: {},
      onOpen: undefined,
    };
  },

  addAttributes() {
    return {
      title: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute("data-wikilink") || element.textContent?.replace(/^\[\[|\]\]$/g, ""),
        renderHTML: (attributes) => {
          if (!attributes.title) return {};
          return { "data-wikilink": attributes.title };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-wikilink]",
      },
    ];
  },

  renderHTML({ HTMLAttributes, mark }) {
    const title = mark.attrs.title || "";
    return [
      "span",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: "wikilink",
        "data-wikilink": title,
        title: `Ouvrir « ${title} »`,
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setWikiLink:
        (title: string) =>
        ({ commands }) => {
          return commands.insertContent(
            `<span data-wikilink="${title}" class="wikilink">[[${title}]]</span>`,
          );
        },
    };
  },
});
