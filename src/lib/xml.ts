/**
 * Minimal, security-hardened XML parser for e-invoice extraction.
 *
 * Workers have no DOMParser, and full XML libraries pull in XXE risk. This
 * parser deliberately:
 *   - REJECTS any DOCTYPE / DTD (`<!DOCTYPE ...>`) — no external DTD loading.
 *   - REJECTS entity declarations (`<!ENTITY ...>`).
 *   - Resolves ONLY the five predefined XML entities (&lt; &gt; &amp; &apos; &quot;)
 *     and numeric character references. No general/external entity expansion.
 * It supports elements, attributes, namespaces (as literal prefixes), text,
 * CDATA, comments and processing instructions — enough for UBL/CII/ZUGFeRD.
 */

export interface XmlNode {
  name: string; // includes prefix, e.g. "cbc:ID"
  localName: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  text: string; // concatenated direct text content
}

export class XmlParseError extends Error {}

export function parseXml(input: string): XmlNode {
  let src = input;
  // Strip BOM.
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);

  if (/<!DOCTYPE/i.test(src)) {
    throw new XmlParseError('DOCTYPE/DTD is not permitted (XXE protection)');
  }
  if (/<!ENTITY/i.test(src)) {
    throw new XmlParseError('Entity declarations are not permitted (XXE protection)');
  }

  let i = 0;
  const n = src.length;

  function skipProlog(): void {
    while (i < n) {
      // whitespace
      while (i < n && isWs(src[i]!)) i++;
      if (src.startsWith('<?', i)) {
        const end = src.indexOf('?>', i);
        if (end === -1) throw new XmlParseError('Unterminated processing instruction');
        i = end + 2;
      } else if (src.startsWith('<!--', i)) {
        const end = src.indexOf('-->', i);
        if (end === -1) throw new XmlParseError('Unterminated comment');
        i = end + 3;
      } else {
        break;
      }
    }
  }

  function parseElement(): XmlNode {
    if (src[i] !== '<') throw new XmlParseError(`Expected '<' at ${i}`);
    i++;
    const name = readName();
    const attributes: Record<string, string> = {};
    // attributes
    for (;;) {
      skipWs();
      const ch = src[i];
      if (ch === '/' && src[i + 1] === '>') {
        i += 2;
        return makeNode(name, attributes, [], '');
      }
      if (ch === '>') {
        i++;
        break;
      }
      const attrName = readName();
      skipWs();
      if (src[i] !== '=') throw new XmlParseError(`Expected '=' after attribute ${attrName}`);
      i++;
      skipWs();
      const quote = src[i];
      if (quote !== '"' && quote !== "'") throw new XmlParseError('Expected quoted attribute value');
      i++;
      const end = src.indexOf(quote, i);
      if (end === -1) throw new XmlParseError('Unterminated attribute value');
      attributes[attrName] = decodeEntities(src.slice(i, end));
      i = end + 1;
    }

    const children: XmlNode[] = [];
    let text = '';
    for (;;) {
      if (i >= n) throw new XmlParseError('Unexpected end of document');
      if (src.startsWith('</', i)) {
        i += 2;
        const closeName = readName();
        skipWs();
        if (src[i] !== '>') throw new XmlParseError('Malformed closing tag');
        i++;
        if (closeName !== name) throw new XmlParseError(`Mismatched tag: ${name} vs ${closeName}`);
        return makeNode(name, attributes, children, text.trim());
      }
      if (src.startsWith('<!--', i)) {
        const end = src.indexOf('-->', i);
        if (end === -1) throw new XmlParseError('Unterminated comment');
        i = end + 3;
        continue;
      }
      if (src.startsWith('<![CDATA[', i)) {
        const end = src.indexOf(']]>', i);
        if (end === -1) throw new XmlParseError('Unterminated CDATA');
        text += src.slice(i + 9, end);
        i = end + 3;
        continue;
      }
      if (src.startsWith('<?', i)) {
        const end = src.indexOf('?>', i);
        if (end === -1) throw new XmlParseError('Unterminated PI');
        i = end + 2;
        continue;
      }
      if (src[i] === '<') {
        children.push(parseElement());
        continue;
      }
      // text run
      const lt = src.indexOf('<', i);
      const chunk = src.slice(i, lt === -1 ? n : lt);
      text += decodeEntities(chunk);
      i = lt === -1 ? n : lt;
    }
  }

  function readName(): string {
    const start = i;
    while (i < n && isNameChar(src[i]!)) i++;
    if (i === start) throw new XmlParseError(`Expected name at ${i}`);
    return src.slice(start, i);
  }
  function skipWs(): void {
    while (i < n && isWs(src[i]!)) i++;
  }

  skipProlog();
  if (src[i] !== '<') throw new XmlParseError('No root element');
  return parseElement();
}

function makeNode(
  name: string,
  attributes: Record<string, string>,
  children: XmlNode[],
  text: string,
): XmlNode {
  const colon = name.indexOf(':');
  return { name, localName: colon === -1 ? name : name.slice(colon + 1), attributes, children, text };
}

function isWs(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r';
}
function isNameChar(c: string): boolean {
  return /[A-Za-z0-9_.:\-]/.test(c);
}

const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', apos: "'", quot: '"' };

/** Only predefined + numeric entities; anything else is left literal. */
function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED[body] ?? m;
  });
}

// --------------------------------------------------------------------------
// Tree query helpers (namespace-prefix agnostic: match by localName).
// --------------------------------------------------------------------------

/** Direct children with the given local name. */
export function childrenByLocal(node: XmlNode, localName: string): XmlNode[] {
  return node.children.filter((c) => c.localName === localName);
}

/** First direct child by local name. */
export function child(node: XmlNode, localName: string): XmlNode | undefined {
  return node.children.find((c) => c.localName === localName);
}

/** Follow a path of local names, returning the first matching node. */
export function findPath(node: XmlNode, path: string[]): XmlNode | undefined {
  let current: XmlNode | undefined = node;
  for (const step of path) {
    if (!current) return undefined;
    current = child(current, step);
  }
  return current;
}

/** Text at a local-name path, or ''. */
export function textAt(node: XmlNode, path: string[]): string {
  return findPath(node, path)?.text ?? '';
}

/** Depth-first search of the first descendant with a local name. */
export function firstDescendant(node: XmlNode, localName: string): XmlNode | undefined {
  for (const c of node.children) {
    if (c.localName === localName) return c;
    const nested = firstDescendant(c, localName);
    if (nested) return nested;
  }
  return undefined;
}
