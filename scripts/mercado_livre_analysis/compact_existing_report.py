#!/usr/bin/env python3
"""Compacta avisos repetidos de uma extração concluída e regenera o relatório."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from run_analysis import Pipeline
from datetime import date

root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
analysis_path = root / "report/analysis.json"
report = json.loads(analysis_path.read_text(encoding="utf-8"))
grouped = {}
for issue in report.get("quality", []):
    key = (issue.get("severity"), issue.get("check"))
    if key not in grouped:
        grouped[key] = {**issue, "detail": str(issue.get("detail", ""))[:500]}
    else:
        grouped[key]["count"] = int(grouped[key].get("count", 0)) + int(issue.get("count", 0))
report["quality"] = list(grouped.values())
analysis_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
pipeline = Pipeline(root, date.fromisoformat(report["snapshot_date"]), False, False)
pipeline.quality.issues = report["quality"]
pipeline.write_quality(report)
pipeline.write_html(report)
pipeline.write_charts(report)
print(f"Relatório compactado: {len(report['quality'])} verificações de qualidade.")
