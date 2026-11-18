/* --------------------------------------------------------------------------
   The one place structured data is written into the document.

   `dangerouslySetInnerHTML` is unavoidable for a <script> body — JSX would
   escape the JSON — so it is confined here rather than repeated per page. The
   payload is always the output of JSON.stringify over an object the server
   built, never a string from a request or from the database verbatim, which is
   what makes it safe: `JSON.stringify` escapes nothing for HTML, so the one
   sequence that could break out of the element is "</script>" appearing inside
   a string value. `escape` below neutralises exactly that, which no caller
   should have to remember.
   -------------------------------------------------------------------------- */

/** `</script>` inside a JSON string value would close this element early and
    let the rest of the value be parsed as markup. `<` is the same
    character to a JSON parser and inert to an HTML one. */
function escape(json: string): string {
  return json.replace(/</g, "\\u003c");
}

export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: escape(JSON.stringify(data)) }}
    />
  );
}
