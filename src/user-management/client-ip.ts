import { BlockList, isIP } from 'node:net';

// Public-egress evidence must not identify a local proxy, private LAN, CGNAT,
// documentation address or other non-global endpoint as an office internet IP.
export const NON_PUBLIC_NETWORKS = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8',
  '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24',
  '192.88.99.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24',
  '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4',
  '::/96', '::ffff:0:0/96', '64:ff9b::/96', '64:ff9b:1::/48',
  '100::/64', '2001::/23', '2001:db8::/32', '2002::/16', '3fff::/20',
  'fc00::/7', 'fe80::/10', 'ff00::/8',
] as const;
const excludedV4 = new BlockList();
const excludedV6 = new BlockList();
for (const cidr of NON_PUBLIC_NETWORKS) {
  const [address, prefix] = cidr.split('/');
  const v4 = isIP(address) === 4;
  (v4 ? excludedV4 : excludedV6).addSubnet(address, Number(prefix), v4 ? 'ipv4' : 'ipv6');
}
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

export function publicClientIp(value: unknown): string | null {
  const address = String(value || '').replace(/^::ffff:/i, '').toLowerCase();
  const version = isIP(address);
  if (!version) return null;
  const type = version === 4 ? 'ipv4' : 'ipv6';
  if ((version === 4 ? excludedV4 : excludedV6).check(address, type) || (version === 6 && !globalV6.check(address, 'ipv6'))) return null;
  return address;
}
