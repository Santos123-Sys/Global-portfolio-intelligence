"""Synthetic fixtures only: numerical regressions and human-decision contracts."""
import unittest
import hashlib
from .replay_weights import replay
import numpy as np
import pandas as pd
from .portfolio_weights import synthetic_prices, run_pipeline, finalize, compute_weights
from .portfolio_weights.validation import walk_forward, perf_metrics
from .portfolio_weights.methods import w_hrp
from .weights_api import ComputeRequest, compute

class PortfolioWeightsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.prices = synthetic_prices(n_days=150, n_assets=3)
        cls.result = run_pipeline(cls.prices, est_window=60, step=21, n_boot=10, seed=7, per_asset_max=.5)

    def test_all_methods_obey_cap_and_sum(self):
        table = self.result['weights_table']
        self.assertEqual(table.shape, (3, 8))
        self.assertTrue((table.values >= 0).all())
        self.assertLessEqual(table.values.max(), .5+1e-7)
        np.testing.assert_allclose(table.sum(), 1)

    def test_defer_and_reject_unsafe_choices(self):
        rec = self.result['recommendation']
        self.assertIsNone(finalize(rec, None))
        self.assertTrue(rec['user_must_choose'])
        for bad in ['invented', {'other': 1}, dict.fromkeys(self.prices.columns, 0),
                    dict(zip(self.prices.columns, [-1, 1, 1])),
                    dict(zip(self.prices.columns, [float('nan'), 1, 1])),
                    dict(zip(self.prices.columns, [float('inf'), 1, 1])),
                    dict(zip(self.prices.columns, [1, 0, 0]))]:
            with self.assertRaises(ValueError):
                finalize(rec, bad, self.result['weights_table'], .5)
        final = finalize(rec, 'HRP', self.result['weights_table'], .5)
        self.assertTrue(final['was_user_decision'])
        self.assertEqual(final['audit']['user_choice'], 'HRP')

    def test_custom_normalization(self):
        final = finalize(self.result['recommendation'], dict.fromkeys(self.prices.columns, 20), self.result['weights_table'], .5)
        np.testing.assert_allclose(list(final['final_weights'].values()), 1/3)

    def test_buy_and_hold_drift_log_conversion_and_first_trade_cost(self):
        # One initial purchase (100% turnover), then 1% purchase cost. Asset A
        # doubles and halves; buy-and-hold finishes exactly at the initial NAV.
        simple = np.tile([[.001, -.001], [-.002, .002]], (12, 1))
        simple[20:] = [[1, 0], [-.5, 0], [0, 0], [0, 0]]
        ret = pd.DataFrame(np.log1p(simple), index=pd.bdate_range('2020-01-01', periods=24))
        _, navs = walk_forward(ret, est_window=20, step=4, cost=.01, methods=['1/N'])
        np.testing.assert_allclose(navs['1/N'].values, [1.485, .99, .99, .99])

    def test_drawdown_includes_initial_loss(self):
        self.assertAlmostEqual(perf_metrics(pd.Series([-.1, 0, 0]))['max_drawdown'], -.1)

    def test_hrp_uses_covariance_correlation(self):
        # With two independent assets, inverse variances split 80/20.
        np.testing.assert_allclose(w_hrp(np.diag([.01, .04])), [.8, .2])

    def test_two_assets_and_infeasible_cap(self):
        table = compute_weights(np.array([.05, .08]), np.diag([.01, .03]))
        self.assertEqual(table.shape, (2, 8))
        with self.assertRaises(ValueError):
            compute_weights(np.array([.05, .08]), np.diag([.01, .03]), per_asset_max=.4)

    def test_no_silent_missing_data_or_short_history(self):
        for frame in [self.prices.iloc[:65], self.prices.assign(Equity_US=np.nan),
                      pd.concat([self.prices, self.prices.iloc[:1]])]:
            with self.assertRaises(ValueError):
                run_pipeline(frame, est_window=60, step=21, n_boot=10)

    def test_deterministic_and_full_ranking_when_drawdown_fails(self):
        second = run_pipeline(self.prices, est_window=60, step=21, n_boot=10, seed=7, per_asset_max=.5, max_drawdown=.0000001)
        pd.testing.assert_frame_equal(self.result['stability'], second['stability'])
        self.assertIsNotNone(second['recommendation']['constraint_flag'])
        self.assertEqual(len(second['recommendation']['ranking']), 8)

    def test_live_adapter_rejects_stale_history_and_accepts_aligned_recent_snapshot(self):
        csv = self.prices.to_csv()
        request = {'prices_csv': csv, 'assets': self.prices.columns.tolist(),
                   'config': {'est_window': 60, 'step': 21, 'n_boot': 10}}
        with self.assertRaisesRegex(ValueError, 'stale'):
            compute(ComputeRequest(**request))
        recent = self.prices.copy()
        recent.index = pd.bdate_range(end=pd.Timestamp.now().normalize(), periods=len(recent))
        request['prices_csv'] = recent.to_csv()
        result = compute(ComputeRequest(**request))
        self.assertEqual(result['engine_version'], 'portfolio-weights/1.0.0')
        self.assertEqual(len(result['recommendation']['ranking']), 8)
        self.assertNotIn('final', result)
        snapshot = {'pricesCsv': request['prices_csv'], 'priceHash': hashlib.sha256(request['prices_csv'].encode()).hexdigest(),
                    'resultJson': result, 'configJson': ComputeRequest(**request).config.model_dump()}
        self.assertEqual(replay(snapshot)['recommended_method'], result['recommendation']['recommended_method'])
        snapshot['pricesCsv'] += '\n'
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            replay(snapshot)

if __name__ == '__main__':
    unittest.main()
