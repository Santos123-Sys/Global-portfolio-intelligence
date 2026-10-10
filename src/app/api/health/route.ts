export function GET() { return Response.json({ status: 'ok', application: 'gpi-usa-cvm-foundation', version: 1 }, { headers: { 'cache-control': 'no-store' } }); }
