"""Deterministic tests for the read-only IBKR mapping and order preview."""
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from .ibkr_portfolio import (IBKRSettings, OrderPreviewRequest, build_order_preview,
                             build_snapshot)


class FakeSession:
    def account_summary(self):
        return [SimpleNamespace(account='U1234567', tag=tag, currency='USD', value=value) for tag, value in (
            ('TotalCashValue', '4000'), ('NetLiquidation', '12000'),
            ('AvailableFunds', '3000'), ('BuyingPower', '6000'))]
    def portfolio(self):
        contract = SimpleNamespace(secType='STK', conId=101, localSymbol='AAPL', symbol='AAPL',
                                   primaryExchange='NASDAQ', exchange='SMART', currency='USD')
        return [SimpleNamespace(contract=contract, position=10, averageCost=180,
                                marketPrice=200, marketValue=2000, unrealizedPNL=200)]
    def fills(self): return []
    async def price(self, request): return 200
    def disconnect(self): pass


class IBKRPortfolioTests(unittest.TestCase):
    def test_snapshot_masks_account_and_marks_execution_history_gap(self):
        result = build_snapshot(FakeSession())
        self.assertEqual(result['account_masked'], '…4567')
        self.assertTrue(result['read_only'])
        self.assertEqual(result['positions'][0]['return_pct'], 2000 / 1800 - 1)
        self.assertIsNone(result['positions'][0]['first_detected_fill'])
        self.assertTrue(any('Entry dates unavailable' in gap for gap in result['information_gaps']))

    def test_multiple_accounts_require_explicit_configuration(self):
        session = FakeSession()
        original = session.account_summary
        session.account_summary = lambda: original() + [SimpleNamespace(account='U9999999', tag='NetLiquidation', currency='USD', value='1')]
        with self.assertRaisesRegex(ValueError, 'IBKR_ACCOUNT'):
            build_snapshot(session)

    def test_preview_applies_caps_and_never_transmits(self):
        settings = IBKRSettings(True, 'gateway', 4002, 41, '', 1000, .25, frozenset({'AAPL'}))
        request = OrderPreviewRequest(symbol='aapl', exchange='smart', currency='USD', amount=800,
                                      side='BUY', order_type='MKT')
        result = build_order_preview(request, 200, 2000, settings)
        self.assertFalse(result['eligible'])
        self.assertFalse(result['transmitted'])
        self.assertEqual(result['quantity'], 4)
        self.assertIn('portion of available funds', result['blockers'][0])

    def test_settings_are_disabled_by_default(self):
        with patch.dict(os.environ, {}, clear=True):
            settings = IBKRSettings.from_env()
        self.assertFalse(settings.enabled)
        self.assertEqual(settings.port, 4002)

    def test_sell_preview_cannot_exceed_the_long_position(self):
        settings = IBKRSettings(True, 'gateway', 4002, 41, '', 1000, .25, frozenset())
        request = OrderPreviewRequest(symbol='AAPL', exchange='SMART', currency='USD', amount=800,
                                      side='SELL', order_type='MKT')
        result = build_order_preview(request, 200, 0, settings, position_quantity=2)
        self.assertFalse(result['eligible'])
        self.assertIn('matching long position', result['blockers'][0])


if __name__ == '__main__':
    unittest.main()
