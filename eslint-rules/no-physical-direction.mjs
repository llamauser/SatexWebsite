/**
 * Forbids physical-direction Tailwind classes (docs/09-i18n.md §2). Use logical ones so Arabic (RTL) works:
 * ml-/mr-  -> ms-/me-     pl-/pr-  -> ps-/pe-     left-/right- -> start-/end-
 * text-left/right -> text-start/end     rounded-l/r(-x) -> rounded-s/e(-x)     border-l/r(-x) -> border-s/e(-x)
 */
const PHYSICAL =
  /(?:^|[\s:!"'`])-?(?:ml|mr|pl|pr|left|right)-|(?:^|[\s:!"'`])(?:text-(?:left|right)|(?:border|rounded)-[lr](?:-|\s|$|"|'|`))/;

const MESSAGE =
  'Physical direction class "{{match}}" is forbidden. Use logical classes (ms-/me-/ps-/pe-/start-/end-/text-start/text-end/rounded-s/rounded-e/border-s/border-e).';

function check(context, node, text) {
  const m = PHYSICAL.exec(text);
  if (m) context.report({ node, message: MESSAGE, data: { match: m[0].trim().replace(/^[:!"'`]/, "") } });
}

const plugin = {
  rules: {
    "no-physical-direction": {
      meta: { type: "problem", schema: [] },
      create(context) {
        return {
          Literal(node) {
            if (typeof node.value === "string") check(context, node, node.value);
          },
          TemplateElement(node) {
            check(context, node, node.value.raw);
          },
        };
      },
    },
  },
};

export default plugin;
