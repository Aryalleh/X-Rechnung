import { describe, it, expect } from 'vitest';
import { decode, encode, el, child, textOf, flag } from '../src/eas/wbxml';

describe('ActiveSync WBXML', () => {
  it('round-trips nested elements across code pages', () => {
    const tree = el('AirSync:Sync', el('AirSync:Collections', el('AirSync:Collection',
      el('AirSync:SyncKey', '3'), el('AirSync:CollectionId', 'inbox'), el('AirSync:DeletesAsMoves'),
      el('AirSync:Options', el('AirSyncBase:BodyPreference', el('AirSyncBase:Type', 2), el('AirSyncBase:TruncationSize', 51200))),
      el('AirSync:Commands', el('AirSync:Change', el('AirSync:ServerId', 'mail_1'), el('AirSync:ApplicationData', el('Email:Read', 1), el('Email:Subject', 'Grüße – سلام')))),
    )));
    const out = decode(encode(tree))!;
    const coll = child(child(out, 'AirSync:Collections'), 'AirSync:Collection');
    expect(textOf(coll, 'AirSync:SyncKey')).toBe('3');
    expect(flag(coll, 'AirSync:DeletesAsMoves')).toBe(true);
    expect(textOf(child(child(coll, 'AirSync:Options'), 'AirSyncBase:BodyPreference'), 'AirSyncBase:TruncationSize')).toBe('51200');
    const app = child(child(child(coll, 'AirSync:Commands'), 'AirSync:Change'), 'AirSync:ApplicationData');
    expect(textOf(app, 'Email:Subject')).toBe('Grüße – سلام');
  });
  it('encodes known byte layout (header, page switch, opaque)', () => {
    const b = encode(el('FolderHierarchy:FolderSync', el('FolderHierarchy:SyncKey', '0')));
    expect([...b.slice(0, 7)]).toEqual([0x03, 0x01, 0x6a, 0x00, 0x00, 0x07, 0x56]); // switch to page 7, FolderSync with content
    const mime = new Uint8Array([0x46, 0x72, 0x00, 0xff]);
    const back = decode(encode(el('ComposeMail:SendMail', el('ComposeMail:Mime', mime))))!;
    expect([...child(back, 'ComposeMail:Mime')!.bytes!]).toEqual([0x46, 0x72, 0x00, 0xff]);
  });
  it('tolerates unknown code pages', () => {
    // page 30 (not defined) tag 0x05 with text "x"
    const raw = new Uint8Array([0x03, 0x01, 0x6a, 0x00, 0x00, 0x1e, 0x45, 0x03, 0x78, 0x00, 0x01]);
    expect(decode(raw)).toMatchObject({ tag: 'P30:0x5', text: 'x' });
  });
});
