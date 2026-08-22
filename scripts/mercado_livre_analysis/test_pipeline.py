import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from run_analysis import Pipeline


class PipelineAnalysisTests(unittest.TestCase):
    def test_abc_and_margin_require_valid_cost(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            pipeline = Pipeline(Path(tmp), date(2026, 8, 1), False, False)
            pipeline.tables["fact_product_costs"] = [{"product_key": "SKU-A", "unit_product_cost": "20", "packaging_cost": "1", "other_variable_cost": "0", "tax_rate": "0", "valid_from": "2026-01-01", "valid_to": ""}]
            pipeline.tables["fact_orders"] = [{"order_id": "o1", "eligible_sale": True, "seller_shipping_cost": 10}, {"order_id": "o2", "eligible_sale": True, "seller_shipping_cost": 0}]
            pipeline.tables["fact_order_items"] = [
                {"order_id": "o1", "product_key": "SKU-A", "title": "Produto A", "quantity": 2, "gross_revenue": 100, "commission": 10, "item_id": "i1", "order_created_date": "2026-07-10"},
                {"order_id": "o2", "product_key": "SKU-B", "title": "Produto B", "quantity": 1, "gross_revenue": 50, "commission": 5, "item_id": "i2", "order_created_date": "2026-06-10"},
            ]
            pipeline.tables["fact_visits_daily"] = [{"date": "2026-07-10", "item_id": "i1", "visits": 20}]
            pipeline.tables["snapshot_platinum_status"] = [{"sales_required": 100, "sales_gap_ui": 20}]
            result = pipeline.analysis()
            a = next(x for x in result["products"] if x["product_key"] == "SKU-A")
            b = next(x for x in result["products"] if x["product_key"] == "SKU-B")
            self.assertEqual(a["margin"], 38)
            self.assertIsNone(b["margin"])
            self.assertEqual(result["abc"]["gross_revenue"][0]["class"], "A")
            self.assertEqual(result["platinum"]["sales_gap_official"], 20)


if __name__ == "__main__":
    unittest.main()
