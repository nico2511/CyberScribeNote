import Image from "@tiptap/extension-image";
import { mergeAttributes } from "@tiptap/core";

export const ResizableImage = Image.extend({
  name: "image",

  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => {
          const w = element.getAttribute("width") || element.style.width;
          if (!w) return null;
          return String(w).replace(/px$/, "");
        },
        renderHTML: (attributes) => {
          if (!attributes.width) return {};
          const w = String(attributes.width);
          const css = w.endsWith("%") ? w : `${w}px`;
          return {
            width: w.replace(/%$/, ""),
            style: `max-width:100%;width:${css};height:auto`,
          };
        },
      },
      "data-md-src": {
        default: null,
        parseHTML: (element) => element.getAttribute("data-md-src"),
        renderHTML: (attributes) => {
          if (!attributes["data-md-src"]) return {};
          return { "data-md-src": attributes["data-md-src"] };
        },
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "img",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: "tiptap-image",
      }),
    ];
  },
});
