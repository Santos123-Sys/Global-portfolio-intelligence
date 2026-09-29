"""Meaningful numerical and sandbox-boundary checks for the teaching example."""
import unittest
import json
import math
from pathlib import Path
import numpy as np
from .example_portfolio import EXAMPLE_ASSETS, EXAMPLE_STARTING_WEIGHTS, compute_example

class ExamplePortfolioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = compute_example()

    def test_real_engine_runs_all_methods_without_finalizing_a_decision(self):
        result = self.result
        self.assertEqual(result['data_kind'], 'synthetic_educational_example')
        self.assertEqual(len(result['recommendation']['ranking']), 8)
        self.assertTrue(result['recommendation']['user_must_choose'])
        self.assertNotIn('final', result)
        self.assertEqual(set(result['sample_starting_weights']), set(EXAMPLE_ASSETS))
        self.assertAlmostEqual(sum(EXAMPLE_STARTING_WEIGHTS), 1)
        self.assertEqual(result['inputs']['asset_order'], list(EXAMPLE_ASSETS))
        for method in result['weights_table']:
            weights = result['weights_table'][method]
            self.assertEqual(set(weights), set(EXAMPLE_ASSETS))
            self.assertAlmostEqual(sum(weights.values()), 1)
            self.assertLessEqual(max(weights.values()), .5 + 1e-7)
        self.assertTrue(np.isfinite(list(result['asset_annualized_volatility'].values())).all())

    def test_repeated_requests_are_deterministic(self):
        self.assertIs(compute_example(), self.result)

    def test_checked_in_dashboard_fixture_matches_the_current_engine(self):
        fixture = Path(__file__).resolve().parents[2] / 'src' / 'lib' / 'example-portfolio-allocation.json'
        with fixture.open(encoding='utf-8') as source:
            self.assert_fixture_equivalent(json.load(source), self.result)

    def assert_fixture_equivalent(self, expected, actual, path='$'):
        """Keep the teaching fixture stable across BLAS solver roundoff."""
        if isinstance(expected, dict):
            self.assertIsInstance(actual, dict, path)
            self.assertEqual(set(expected), set(actual), path)
            for key in expected:
                self.assert_fixture_equivalent(expected[key], actual[key], f'{path}.{key}')
        elif isinstance(expected, list):
            self.assertIsInstance(actual, list, path)
            self.assertEqual(len(expected), len(actual), path)
            for index, (left, right) in enumerate(zip(expected, actual)):
                self.assert_fixture_equivalent(left, right, f'{path}[{index}]')
        elif isinstance(expected, float):
            self.assertIsInstance(actual, float, path)
            self.assertTrue(math.isclose(expected, actual, rel_tol=1e-6, abs_tol=1e-8),
                            f'{path}: fixture {expected!r}, engine {actual!r}')
        else:
            self.assertEqual(expected, actual, path)

if __name__ == '__main__':
    unittest.main()
