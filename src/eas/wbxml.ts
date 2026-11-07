/**
 * WBXML codec for Exchange ActiveSync (MS-ASWBXML).
 *
 * Elements are addressed as "Page:Tag" (e.g. "AirSync:SyncKey"). Only the code
 * pages a mail-only server needs are named; unknown tokens decode as "P<n>:0x<id>"
 * so foreign elements (contacts, calendar) never break parsing.
 */

const PAGES: Record<number, [string, string[]]> = {
  0: ['AirSync', ['Sync', 'Responses', 'Add', 'Change', 'Delete', 'Fetch', 'SyncKey', 'ClientId', 'ServerId', 'Status', 'Collection', 'Class',
    'Version', 'CollectionId', 'GetChanges', 'MoreAvailable', 'WindowSize', 'Commands', 'Options', 'FilterType', 'Truncation', 'RTFTruncation',
    'Conflict', 'Collections', 'ApplicationData', 'DeletesAsMoves', 'NotifyGUID', 'Supported', 'SoftDelete', 'MIMESupport', 'MIMETruncation',
    'Wait', 'Limit', 'Partial', 'ConversationMode', 'MaxItems', 'HeartbeatInterval']],
  1: ['Contacts', ['Anniversary', 'AssistantName', 'AssistantPhoneNumber', 'Birthday', 'Body', 'BodySize', 'BodyTruncated', 'Business2PhoneNumber',
    'BusinessAddressCity', 'BusinessAddressCountry', 'BusinessAddressPostalCode', 'BusinessAddressState', 'BusinessAddressStreet', 'BusinessFaxNumber',
    'BusinessPhoneNumber', 'CarPhoneNumber', 'Categories', 'Category', 'Children', 'Child', 'CompanyName', 'Department', 'Email1Address',
    'Email2Address', 'Email3Address', 'FileAs', 'FirstName', 'Home2PhoneNumber', 'HomeAddressCity', 'HomeAddressCountry', 'HomeAddressPostalCode',
    'HomeAddressState', 'HomeAddressStreet', 'HomeFaxNumber', 'HomePhoneNumber', 'JobTitle', 'LastName', 'MiddleName', 'MobilePhoneNumber',
    'OfficeLocation', 'OtherAddressCity', 'OtherAddressCountry', 'OtherAddressPostalCode', 'OtherAddressState', 'OtherAddressStreet', 'PagerNumber',
    'RadioPhoneNumber', 'Spouse', 'Suffix', 'Title', 'WebPage', 'YomiCompanyName', 'YomiFirstName', 'YomiLastName', 'CompressedRTF', 'Picture',
    'Alias', 'WeightedRank']],
  2: ['Email', ['Attachment', 'Attachments', 'AttName', 'AttSize', 'Att0Id', 'AttMethod', 'AttRemoved', 'Body', 'BodySize', 'BodyTruncated',
    'DateReceived', 'DisplayName', 'DisplayTo', 'Importance', 'MessageClass', 'Subject', 'Read', 'To', 'Cc', 'From', 'ReplyTo', 'AllDayEvent',
    'Categories', 'Category', 'DTStamp', 'EndTime', 'InstanceType', 'BusyStatus', 'Location', 'MeetingRequest', 'Organizer', 'RecurrenceId',
    'Reminder', 'ResponseRequested', 'Recurrences', 'Recurrence', 'Recurrence_Type', 'Recurrence_Until', 'Recurrence_Occurrences',
    'Recurrence_Interval', 'Recurrence_DayOfWeek', 'Recurrence_DayOfMonth', 'Recurrence_WeekOfMonth', 'Recurrence_MonthOfYear', 'StartTime',
    'Sensitivity', 'TimeZone', 'GlobalObjId', 'ThreadTopic', 'MIMEData', 'MIMETruncated', 'MIMESize', 'InternetCPID', 'Flag', 'FlagStatus',
    'ContentClass', 'FlagType', 'CompleteTime', 'DisallowNewTimeProposal']],
  4: ['Calendar', ['TimeZone', 'AllDayEvent', 'Attendees', 'Attendee', 'Email', 'Name', 'Body', 'BodyTruncated', 'BusyStatus', 'Categories',
    'Category', 'CompressedRTF', 'DtStamp', 'EndTime', 'Exception', 'Exceptions', 'Deleted', 'ExceptionStartTime', 'Location', 'MeetingStatus',
    'OrganizerEmail', 'OrganizerName', 'Recurrence', 'Type', 'Until', 'Occurrences', 'Interval', 'DayOfWeek', 'DayOfMonth', 'WeekOfMonth',
    'MonthOfYear', 'Reminder', 'Sensitivity', 'Subject', 'StartTime', 'UID', 'AttendeeStatus', 'AttendeeType', 'Attachment', 'Attachments',
    'AttName', 'AttSize', 'AttOid', 'AttMethod', 'AttRemoved', 'DisplayName', 'DisallowNewTimeProposal', 'ResponseRequested', 'AppointmentReplyTime',
    'ResponseType', 'CalendarType', 'IsLeapMonth', 'FirstDayOfWeek', 'OnlineMeetingConfLink', 'OnlineMeetingExternalLink']],
  5: ['Move', ['MoveItems', 'Move', 'SrcMsgId', 'SrcFldId', 'DstFldId', 'Response', 'Status', 'DstMsgId']],
  6: ['GetItemEstimate', ['GetItemEstimate', 'Version', 'Collections', 'Collection', 'Class', 'CollectionId', 'DateTime', 'Estimate', 'Response', 'Status']],
  7: ['FolderHierarchy', ['Folders', 'Folder', 'DisplayName', 'ServerId', 'ParentId', 'Type', 'Response', 'Status', 'ContentClass', 'Changes', 'Add',
    'Delete', 'Update', 'SyncKey', 'FolderCreate', 'FolderDelete', 'FolderUpdate', 'FolderSync', 'Count', 'Version']],
  13: ['Ping', ['Ping', 'AutdState', 'Status', 'HeartbeatInterval', 'Folders', 'Folder', 'Id', 'Class', 'MaxFolders']],
  14: ['Provision', ['Provision', 'Policies', 'Policy', 'PolicyType', 'PolicyKey', 'Data', 'Status', 'RemoteWipe', 'EASProvisionDoc',
    'DevicePasswordEnabled', 'AlphanumericDevicePasswordRequired', 'DeviceEncryptionEnabled', 'PasswordRecoveryEnabled', 'DocumentBrowseEnabled',
    'AttachmentsEnabled', 'MinDevicePasswordLength', 'MaxInactivityTimeDeviceLock', 'MaxDevicePasswordFailedAttempts', 'MaxAttachmentSize',
    'AllowSimpleDevicePassword', 'DevicePasswordExpiration', 'DevicePasswordHistory', 'AllowStorageCard', 'AllowCamera', 'RequireDeviceEncryption',
    'AllowUnsignedApplications', 'AllowUnsignedInstallationPackages', 'MinDevicePasswordComplexCharacters', 'AllowWiFi', 'AllowTextMessaging',
    'AllowPOPIMAPEmail', 'AllowBluetooth', 'AllowIrDA', 'RequireManualSyncWhenRoaming', 'AllowDesktopSync', 'MaxCalendarAgeFilter', 'AllowHTMLEmail',
    'MaxEmailAgeFilter', 'MaxEmailBodyTruncationSize', 'MaxEmailHTMLBodyTruncationSize', 'RequireSignedSMIMEMessages', 'RequireEncryptedSMIMEMessages',
    'RequireSignedSMIMEAlgorithm', 'RequireEncryptionSMIMEAlgorithm', 'AllowSMIMEEncryptionAlgorithmNegotiation', 'AllowSMIMESoftCerts', 'AllowBrowser',
    'AllowConsumerEmail', 'AllowRemoteDesktop', 'AllowInternetSharing', 'UnapprovedInROMApplicationList', 'ApplicationName', 'ApprovedApplicationList', 'Hash']],
  15: ['Search', ['Search', 'Stores', 'Store', 'Name', 'Query', 'Options', 'Range', 'Status', 'Response', 'Result', 'Properties', 'Total', 'EqualTo',
    'Value', 'And', 'Or', 'FreeText', 'SubstringOp', 'DeepTraversal', 'LongId', 'RebuildResults', 'LessThan', 'GreaterThan', 'Schema', 'Supported',
    'UserName', 'Password', 'ConversationId', 'Picture', 'MaxSize', 'MaxPictures']],
  16: ['GAL', ['DisplayName', 'Phone', 'Office', 'Title', 'Company', 'Alias', 'FirstName', 'LastName', 'HomePhone', 'MobilePhone', 'EmailAddress', 'Picture', 'Status', 'Data']],
  17: ['AirSyncBase', ['BodyPreference', 'Type', 'TruncationSize', 'AllOrNone', 'Reserved', 'Body', 'Data', 'EstimatedDataSize', 'Truncated',
    'Attachments', 'Attachment', 'DisplayName', 'FileReference', 'Method', 'ContentId', 'ContentLocation', 'IsInline', 'NativeBodyType',
    'ContentType', 'Preview', 'BodyPartPreference', 'BodyPart', 'Status']],
  18: ['Settings', ['Settings', 'Status', 'Get', 'Set', 'Oof', 'OofState', 'StartTime', 'EndTime', 'OofMessage', 'AppliesToInternal',
    'AppliesToExternalKnown', 'AppliesToExternalUnknown', 'Enabled', 'ReplyMessage', 'BodyType', 'DevicePassword', 'Password', 'DeviceInformation',
    'Model', 'IMEI', 'FriendlyName', 'OS', 'OSLanguage', 'PhoneNumber', 'UserInformation', 'EmailAddresses', 'SmtpAddress', 'UserAgent',
    'EnableOutboundSMS', 'MobileOperator', 'PrimarySmtpAddress', 'Accounts', 'Account', 'AccountId', 'AccountName', 'UserDisplayName',
    'SendDisabled', 'Unused2A', 'RightsManagementInformation']],
  20: ['ItemOperations', ['ItemOperations', 'Fetch', 'Store', 'Options', 'Range', 'Total', 'Properties', 'Data', 'Status', 'Response', 'Version',
    'Schema', 'Part', 'EmptyFolderContents', 'DeleteSubFolders', 'UserName', 'Password', 'Move', 'DstFldId', 'ConversationId', 'MoveAlways']],
  21: ['ComposeMail', ['SendMail', 'SmartForward', 'SmartReply', 'SaveInSentItems', 'ReplaceMime', 'Unused0A', 'Source', 'FolderId', 'ItemId',
    'LongId', 'InstanceId', 'Mime', 'ClientId', 'Status', 'AccountId']],
  22: ['Email2', ['UmCallerID', 'UmUserNotes', 'UmAttDuration', 'UmAttOrder', 'ConversationId', 'ConversationIndex', 'LastVerbExecuted',
    'LastVerbExecutionTime', 'ReceivedAsBcc', 'Sender', 'CalendarType', 'IsLeapMonth', 'AccountId', 'FirstDayOfWeek', 'MeetingMessageType']],
  23: ['Notes', ['Subject', 'MessageClass', 'LastModifiedDate', 'Categories', 'Category']],
};

const BY_NAME = new Map<string, [number, number]>();
for (const [page, [ns, tags]] of Object.entries(PAGES)) tags.forEach((t, i) => BY_NAME.set(`${ns}:${t}`, [Number(page), i + 5]));

export interface WNode {
  tag: string;
  children: WNode[];
  /** Text content (UTF-8 decoded). */
  text?: string;
  /** Raw content bytes: OPAQUE data, or the bytes of inline strings. */
  bytes?: Uint8Array;
}

/** Child value: element, string/number (text), Uint8Array (opaque), or null/false (skipped). */
type Kid = WNode | string | number | Uint8Array | null | undefined | false | Kid[];

/** Build an element. `el('AirSync:Status', 1)`, `el('AirSync:Sync', el(...), el(...))`. */
export function el(tag: string, ...kids: Kid[]): WNode {
  const node: WNode = { tag, children: [] };
  const add = (k: Kid) => {
    if (k === null || k === undefined || k === false) return;
    if (Array.isArray(k)) { k.forEach(add); return; }
    if (typeof k === 'string' || typeof k === 'number') node.text = (node.text ?? '') + String(k);
    else if (k instanceof Uint8Array) node.bytes = k;
    else node.children.push(k);
  };
  kids.forEach(add);
  return node;
}

// ------------------------------- encoding -------------------------------
const te = new TextEncoder();

function mbUint(out: number[], n: number): void {
  const bytes = [n & 0x7f];
  n >>>= 7;
  while (n > 0) { bytes.unshift((n & 0x7f) | 0x80); n >>>= 7; }
  out.push(...bytes);
}

export function encode(root: WNode): Uint8Array {
  const chunks: Uint8Array[] = [];
  let buf: number[] = [0x03, 0x01, 0x6a, 0x00]; // WBXML 1.3, unknown public id, UTF-8, empty string table
  const flush = () => { if (buf.length) { chunks.push(Uint8Array.from(buf)); buf = []; } };
  let page = 0;
  const walk = (n: WNode) => {
    const tok = BY_NAME.get(n.tag);
    if (!tok) throw new Error(`wbxml: unknown tag ${n.tag}`);
    if (tok[0] !== page) { buf.push(0x00, tok[0]); page = tok[0]; }
    const hasContent = n.children.length > 0 || n.text !== undefined || n.bytes !== undefined;
    buf.push(tok[1] | (hasContent ? 0x40 : 0));
    if (!hasContent) return;
    if (n.bytes !== undefined) {
      buf.push(0xc3); mbUint(buf, n.bytes.length); flush(); chunks.push(n.bytes);
    } else if (n.text !== undefined) {
      buf.push(0x03); flush(); chunks.push(te.encode(n.text.replace(/\0/g, ''))); buf.push(0x00);
    }
    n.children.forEach(walk);
    buf.push(0x01);
  };
  walk(root);
  flush();
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// ------------------------------- decoding -------------------------------
const td = new TextDecoder();

export function decode(data: Uint8Array): WNode | null {
  if (data.length < 4) return null;
  let i = 1; // skip version
  const mb = () => { let v = 0; let b: number; do { b = data[i++]!; v = (v << 7) | (b & 0x7f); } while (b & 0x80 && i < data.length); return v; };
  const publicId = mb();
  if (publicId === 0) mb();
  mb(); // charset
  const strtbl = mb();
  i += strtbl;

  let page = 0;
  const stack: WNode[] = [];
  let root: WNode | null = null;
  const appendBytes = (n: WNode, b: Uint8Array) => {
    if (!n.bytes) n.bytes = b;
    else { const m = new Uint8Array(n.bytes.length + b.length); m.set(n.bytes); m.set(b, n.bytes.length); n.bytes = m; }
    n.text = td.decode(n.bytes);
  };
  while (i < data.length) {
    const tok = data[i++]!;
    const cur = stack[stack.length - 1];
    if (tok === 0x00) { page = data[i++]!; continue; }
    if (tok === 0x01) { stack.pop(); continue; }
    if (tok === 0x02) { const cp = mb(); if (cur) appendBytes(cur, te.encode(String.fromCodePoint(cp))); continue; }
    if (tok === 0x03) {
      const start = i;
      while (i < data.length && data[i] !== 0x00) i++;
      if (cur) appendBytes(cur, data.slice(start, i));
      i++;
      continue;
    }
    if (tok === 0xc3) {
      const len = mb();
      if (cur) appendBytes(cur, data.slice(i, i + len));
      i += len;
      continue;
    }
    if (tok === 0x83) { mb(); continue; } // STR_T (string table): unused by ActiveSync clients
    const id = tok & 0x3f;
    const def = PAGES[page];
    const name = def && def[1][id - 5] ? `${def[0]}:${def[1][id - 5]}` : `P${page}:0x${id.toString(16)}`;
    const node: WNode = { tag: name, children: [] };
    if (cur) cur.children.push(node); else root = node;
    if (tok & 0x80) { while (i < data.length && data[i] !== 0x01) i++; i++; } // attributes: skip
    if (tok & 0x40) stack.push(node);
  }
  return root;
}

// ------------------------------- helpers -------------------------------
export const child = (n: WNode | null | undefined, tag: string): WNode | undefined => n?.children.find((c) => c.tag === tag);
export const kids = (n: WNode | null | undefined, tag: string): WNode[] => n?.children.filter((c) => c.tag === tag) ?? [];
export const textOf = (n: WNode | null | undefined, tag: string): string | undefined => child(n, tag)?.text;
/** Present as an empty element or with a truthy value ("1"). */
export const flag = (n: WNode | null | undefined, tag: string): boolean | undefined => {
  const c = child(n, tag);
  if (!c) return undefined;
  return c.text === undefined || c.text === '' || c.text === '1';
};
