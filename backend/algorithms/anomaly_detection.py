import json
import sys
import math


def main(input_data):
    metrics_data = input_data.get("metrics_data", [])

    if not metrics_data:
        return {"error": "missing_required_field", "field": "metrics_data",
                "message": "缺少必填字段 metrics_data"}

    anomalies = []

    for metric in metrics_data:
        metric_name = metric.get("name", "unknown")
        values = metric.get("values", [])

        if len(values) < 3:
            continue

        n = len(values)
        mean = sum(values) / n
        variance = sum((v - mean) ** 2 for v in values) / n
        std_dev = math.sqrt(variance) if variance > 0 else 0

        if std_dev == 0:
            continue

        threshold = 2.5

        for i, v in enumerate(values):
            z_score = abs(v - mean) / std_dev
            if z_score > threshold:
                if v > mean:
                    anomaly_type = "spike"
                elif v < mean:
                    anomaly_type = "drop"
                else:
                    anomaly_type = "trend"

                anomalies.append({
                    "metric": metric_name,
                    "index": i,
                    "value": v,
                    "expected_mean": round(mean, 4),
                    "z_score": round(z_score, 4),
                    "anomaly_type": anomaly_type,
                    "severity": "high" if z_score > 3.0 else "medium"
                })

    overall_score = min(1.0, len(anomalies) / max(len(metrics_data), 1))

    return {
        "anomalies": anomalies,
        "anomaly_score": round(overall_score, 4),
        "total_anomalies": len(anomalies),
        "metrics_analyzed": len(metrics_data),
        "method": "z_score",
        "threshold": 2.5
    }


if __name__ == "__main__":
    input_json = json.loads(sys.stdin.read())
    result = main(input_json)
    print(json.dumps(result, ensure_ascii=False))