import json
import sys
from datetime import datetime, timedelta


def main(input_data):
    product_id = input_data.get("product_id")
    historical_sales = input_data.get("historical_sales", [])
    forecast_period = input_data.get("forecast_period", 3)

    if not historical_sales:
        return {"error": "missing_required_field", "field": "historical_sales",
                "message": "缺少必填字段 historical_sales"}

    n = len(historical_sales)
    if n < 3:
        return {"error": "insufficient_data", "field": "historical_sales",
                "message": f"历史数据不足，至少需要3个月，当前{n}个月"}

    weights = list(range(1, n + 1))
    weighted_sum = sum(w * s for w, s in zip(weights, historical_sales))
    weight_total = sum(weights)
    forecast_base = weighted_sum / weight_total

    diffs = [historical_sales[i] - historical_sales[i - 1] for i in range(1, n)]
    trend = sum(diffs) / len(diffs) if diffs else 0

    recent = historical_sales[-min(3, n):]
    mean_recent = sum(recent) / len(recent)
    variance = sum((s - mean_recent) ** 2 for s in recent) / len(recent)
    std_dev = variance ** 0.5

    forecast_quantity = max(0, forecast_base + trend * forecast_period * 0.5)
    z_score = 1.96
    margin = z_score * std_dev * (forecast_period ** 0.5)

    return {
        "product_id": product_id,
        "forecast_quantity": round(forecast_quantity, 2),
        "confidence_lower": round(max(0, forecast_quantity - margin), 2),
        "confidence_upper": round(forecast_quantity + margin, 2),
        "trend": round(trend, 2),
        "method": "weighted_moving_average",
        "forecast_period_months": forecast_period
    }


if __name__ == "__main__":
    input_json = json.loads(sys.stdin.read())
    result = main(input_json)
    print(json.dumps(result, ensure_ascii=False))