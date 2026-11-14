/**
 * SoftEther domain knowledge the UI needs: names for wire enums, and a
 * catalogue of the security-policy fields with human labels, grouping, units
 * and defaults -- this is what turns the API's forty raw `policy:` fields into
 * a form a person can read.
 */
import type { Wire } from "./api";

export const AUTH_TYPES: Record<number, string> = {
  0: "匿名",
  1: "密码",
  2: "用户证书",
  3: "已签名证书",
  4: "RADIUS",
  5: "NT 域",
};

export const AUTH_TYPE_OPTIONS = [
  { value: 1, label: "密码", hint: "密码保存在 VPN 服务器上。" },
  { value: 0, label: "匿名", hint: "任何以该用户名连接的人都能登录，通常不建议。" },
  { value: 2, label: "用户证书", hint: "需在该用户上登记指定的 X.509 证书。" },
  { value: 3, label: "已签名证书", hint: "任何由虚拟 HUB 受信 CA 签发的证书均可。" },
  { value: 4, label: "RADIUS", hint: "交由虚拟 HUB 的 RADIUS 服务器验证。" },
  { value: 5, label: "NT 域", hint: "交由 Windows 域控制器验证。" },
];

export const HUB_TYPES: Record<number, string> = {
  0: "独立",
  1: "静态（集群）",
  2: "动态（集群）",
};

export const SESSION_TYPE = (s: Wire): string => {
  if (s["LinkMode_bool"]) return "级联";
  if (s["SecureNATMode_bool"]) return "SecureNAT";
  if (s["BridgeMode_bool"]) return "网桥";
  if (s["Layer3Mode_bool"]) return "三层交换";
  return "客户端";
};

export interface PolicyField {
  key: string; // wire name, e.g. "policy:MaxUpload_u32"
  label: string;
  help: string;
  kind: "bool" | "number";
  unit?: string;
  /** For numbers: what 0 means (usually "no limit"). */
  zero?: string;
  group: string;
}

export const POLICY_GROUPS = [
  "访问",
  "带宽与会话",
  "地址数量限制",
  "过滤",
  "IPv6",
  "高级",
] as const;

export const POLICY_FIELDS: PolicyField[] = [
  // -- access ------------------------------------------------------------------
  { key: "policy:Access_bool", label: "允许访问", help: "总开关：关闭后拒绝该用户的所有连接。", kind: "bool", group: "访问" },
  { key: "policy:MultiLogins_u32", label: "并发登录数", help: "该用户可同时保持的会话数量。", kind: "number", zero: "不限", group: "访问" },
  { key: "policy:MaxConnection_u32", label: "每会话 TCP 连接数", help: "单个 VPN 会话可并行建立的 TCP 通道数。", kind: "number", zero: "服务器默认", group: "访问" },
  { key: "policy:TimeOut_u32", label: "空闲超时", help: "无流量持续该秒数后断开连接。", kind: "number", unit: "s", zero: "服务器默认", group: "访问" },
  { key: "policy:AutoDisconnect_u32", label: "自动断开", help: "无论是否活跃，会话持续该秒数后强制断开。", kind: "number", unit: "s", zero: "永不", group: "访问" },
  { key: "policy:FixPassword_bool", label: "禁止修改密码", help: "用户无法从客户端自行修改密码。", kind: "bool", group: "访问" },
  { key: "policy:NoSavePassword_bool", label: "禁止保存密码", help: "客户端每次连接时都必须重新输入密码。", kind: "bool", group: "访问" },

  // -- bandwidth ----------------------------------------------------------------
  { key: "policy:MaxUpload_u32", label: "上传限速", help: "该用户发往虚拟 HUB 的流量上限。", kind: "number", unit: "bytes/s", zero: "不限", group: "带宽与会话" },
  { key: "policy:MaxDownload_u32", label: "下载限速", help: "虚拟 HUB 发往该用户的流量上限。", kind: "number", unit: "bytes/s", zero: "不限", group: "带宽与会话" },
  { key: "policy:NoQoS_bool", label: "停用 VoIP/QoS 优先级", help: "对该用户的所有数据包一视同仁。", kind: "bool", group: "带宽与会话" },
  { key: "policy:NoBroadcastLimiter_bool", label: "不限广播", help: "该用户不受虚拟 HUB 广播风暴限制的约束。", kind: "bool", group: "带宽与会话" },
  { key: "policy:MonitorPort_bool", label: "监控模式", help: "该会话可镜像虚拟 HUB 的流量（抓包端口）。", kind: "bool", group: "带宽与会话" },

  // -- address limits --------------------------------------------------------------
  { key: "policy:MaxMac_u32", label: "MAC 地址数", help: "该会话可注册的 MAC 地址数量。", kind: "number", zero: "不限", group: "地址数量限制" },
  { key: "policy:MaxIP_u32", label: "IPv4 地址数", help: "该会话可注册的 IPv4 地址数量。", kind: "number", zero: "不限", group: "地址数量限制" },
  { key: "policy:MaxIPv6_u32", label: "IPv6 地址数", help: "该会话可注册的 IPv6 地址数量。", kind: "number", zero: "不限", group: "IPv6" },
  { key: "policy:CheckMac_bool", label: "强制执行 MAC 限制", help: "丢弃超出数量限制的 MAC 地址发来的帧。", kind: "bool", group: "地址数量限制" },
  { key: "policy:CheckIP_bool", label: "强制执行 IPv4 限制", help: "丢弃超出数量限制的 IPv4 地址发来的包。", kind: "bool", group: "地址数量限制" },
  { key: "policy:CheckIPv6_bool", label: "强制执行 IPv6 限制", help: "丢弃超出数量限制的 IPv6 地址发来的包。", kind: "bool", group: "IPv6" },

  // -- filtering ---------------------------------------------------------------------
  { key: "policy:DHCPFilter_bool", label: "过滤 DHCP（IPv4）", help: "丢弃穿过该会话的 DHCP 数据包。", kind: "bool", group: "过滤" },
  { key: "policy:DHCPNoServer_bool", label: "禁止充当 DHCP 服务器", help: "该用户不得响应 DHCP 请求。", kind: "bool", group: "过滤" },
  { key: "policy:DHCPForce_bool", label: "仅允许 DHCP 分配的地址", help: "只接受由 DHCP 分配的 IPv4 地址。", kind: "bool", group: "过滤" },
  { key: "policy:NoBridge_bool", label: "禁止网桥", help: "丢弃来自客户端后面其他 MAC 地址的帧。", kind: "bool", group: "过滤" },
  { key: "policy:NoRouting_bool", label: "禁止路由（IPv4）", help: "该用户不得充当 IPv4 路由器。", kind: "bool", group: "过滤" },
  { key: "policy:NoServer_bool", label: "禁止充当服务器（IPv4）", help: "阻止发往该用户的入站 TCP 连接。", kind: "bool", group: "过滤" },
  { key: "policy:PrivacyFilter_bool", label: "隐私过滤", help: "同带此策略的用户之间不能互访。", kind: "bool", group: "过滤" },
  { key: "policy:ArpDhcpOnly_bool", label: "仅允许 ARP/DHCP/ICMPv6 广播", help: "丢弃其他所有广播。", kind: "bool", group: "过滤" },
  { key: "policy:FilterIPv4_bool", label: "丢弃所有 IPv4", help: "IPv4 数据包不能穿过该会话。", kind: "bool", group: "过滤" },
  { key: "policy:FilterIPv6_bool", label: "丢弃所有 IPv6", help: "IPv6 数据包不能穿过该会话。", kind: "bool", group: "IPv6" },
  { key: "policy:FilterNonIP_bool", label: "丢弃非 IP 帧", help: "丢弃所有非 IPv4/IPv6/ARP 的帧。", kind: "bool", group: "过滤" },

  // -- IPv6 ----------------------------------------------------------------------------
  { key: "policy:RSandRAFilter_bool", label: "过滤 RS/RA", help: "丢弃 IPv6 路由器请求与通告。", kind: "bool", group: "IPv6" },
  { key: "policy:RAFilter_bool", label: "过滤 RA", help: "仅丢弃 IPv6 路由器通告。", kind: "bool", group: "IPv6" },
  { key: "policy:DHCPv6Filter_bool", label: "过滤 DHCPv6", help: "丢弃穿过该会话的 DHCPv6 数据包。", kind: "bool", group: "IPv6" },
  { key: "policy:DHCPv6NoServer_bool", label: "禁止充当 DHCPv6 服务器", help: "该用户不得响应 DHCPv6 请求。", kind: "bool", group: "IPv6" },
  { key: "policy:NoRoutingV6_bool", label: "禁止路由（IPv6）", help: "该用户不得充当 IPv6 路由器。", kind: "bool", group: "IPv6" },
  { key: "policy:NoServerV6_bool", label: "禁止充当服务器（IPv6）", help: "阻止发往该用户的入站 IPv6 连接。", kind: "bool", group: "IPv6" },
  { key: "policy:NoIPv6DefaultRouterInRA_bool", label: "从 RA 中去除默认路由", help: "路由器通告照常通过，但默认路由位被清除。", kind: "bool", group: "IPv6" },
  { key: "policy:NoIPv6DefaultRouterInRAWhenIPv6_bool", label: "从 RA 中去除默认路由（IPv6 隧道）", help: "同上，但仅针对物理 IPv6 VPN 连接。", kind: "bool", group: "IPv6" },

  // -- advanced ---------------------------------------------------------------------------
  { key: "policy:VLanId_u32", label: "VLAN ID", help: "将该用户的流量标记到指定 VLAN。", kind: "number", zero: "无", group: "高级" },
  { key: "policy:Ver3_bool", label: "版本 3 策略", help: "在旧服务器上启用上述较新的策略字段。", kind: "bool", group: "高级" },
];

/** Access-list rule fields, in the order a person reads a firewall rule. */
export const ACCESS_PROTOCOLS: Record<number, string> = {
  0: "任意",
  1: "ICMPv4",
  6: "TCP",
  17: "UDP",
  58: "ICMPv6",
};

/** A session name like "SID-USER-123" is server plumbing; show the tail. */
export function shortSession(name: string): string {
  return name.replace(/^SID-/, "");
}

/** Cumulative user transfer, both directions, from EnumUser/GetUser output. */
export function userBytes(u: Wire): { send: number; recv: number } {
  const pick = (prefix: string) =>
    (Number(u[`${prefix}.BroadcastBytes_u64`]) || 0) + (Number(u[`${prefix}.UnicastBytes_u64`]) || 0);
  // EnumUser prefixes the counters with "Ex."; GetUser does not.
  const ex = "Ex.Recv.BroadcastBytes_u64" in u;
  return {
    send: pick(ex ? "Ex.Send" : "Send"),
    recv: pick(ex ? "Ex.Recv" : "Recv"),
  };
}

/** True when the wire datetime means "unset" (SoftEther uses epoch-ish zeros). */
export function isNever(iso: string | null | undefined): boolean {
  if (!iso) return true;
  const d = new Date(iso);
  return !isFinite(d.getTime()) || d.getFullYear() < 1990;
}

/** How usable an account is, worst last -- the order the status column sorts
 *  in, and the same precedence the status pill itself renders by. */
function userStateRank(u: Wire, online?: boolean): number {
  if (u.DenyAccess_bool) return 3;
  const expires = (u.Expires_dt ?? u.ExpireTime_dt) as string;
  if (!isNever(expires) && new Date(expires).getTime() < Date.now()) return 2;
  return (online ?? Boolean(u.Online_bool)) ? 0 : 1;
}

/**
 * What a user row is worth in a sorted column, keyed by the column.
 *
 * Both user tables sort through this, so "sorted by transfer" means the same
 * thing on a hub's list as on the server-wide one. Dates that mean "never"
 * sort to the end they belong at: never-logged-in is the oldest possible
 * login, never-expires is the furthest possible expiry.
 */
export function userSortValue(u: Wire, key: string, online?: boolean): string | number {
  switch (key) {
    case "user":
      return String(u.Name_str ?? "").toLowerCase();
    case "hub":
      return String(u.HubName_str ?? "").toLowerCase();
    case "status":
      return userStateRank(u, online);
    case "group":
      return String(u.GroupName_str ?? "").toLowerCase();
    case "auth":
      return AUTH_TYPES[Number(u.AuthType_u32)] ?? "";
    case "login": {
      const t = u.LastLoginTime_dt as string;
      return isNever(t) ? 0 : new Date(t).getTime();
    }
    case "logins":
      return Number(u.NumLogin_u32) || 0;
    case "transfer": {
      const b = userBytes(u);
      return b.send + b.recv;
    }
    case "expires": {
      const e = (u.Expires_dt ?? u.ExpireTime_dt) as string;
      // Not Infinity: the numeric comparator subtracts, and Infinity minus
      // Infinity is NaN, which makes a sort silently incoherent.
      return isNever(e) ? Number.MAX_SAFE_INTEGER : new Date(e).getTime();
    }
    default:
      return "";
  }
}
