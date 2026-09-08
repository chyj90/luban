import json
import sys
import math


def main(input_data):
    daily_consumption_mean = input_data.get("daily_consumption_mean")
    daily_consumption_std = input_data.get("daily_consumption_std", 0)
    lead_time = input_data.get("lead_time")
    service_level = input_data.get("service_level", 0.95)

    if daily_consumption_mean is None:
        return {"error": "missing_required_field", "field": "daily_consumption_mean",
                "message": "缺少必填字段 daily_consumption_mean"}
    if lead_time is None:
        return {"error": "missing_required_field", "field": "lead_time",
                "message": "缺少必填字段 lead_time"}

    z_map = {
        0.90: 1.28, 0.95: 1.645, 0.975: 1.96, 0.99: 2.326, 0.999: 3.09
    }
    z = z_map.get(service_level, 1.645)

    safety_stock = z * daily_consumption_std * math.sqrt(lead_time)

    reorder_point = daily_consumption_mean * lead_time + safety_stock

    current_stock = input_data.get("current_stock")
    stock_status = "unknown"
    days_of_supply = None
    if current_stock is not None and daily_consumption_mean > 0:
        days_of_supply = current_stock / daily_consumption_mean
        if current_stock < safety_stock:
            stock_status = "critical"
        elif current_stock < reorder_point:
            stock_status = "below_reorder_point"
        else:
            stock_status = "adequate"

    return {
        "safety_stock": round(safety_stock, 2),
        "reorder_point": round(reorder_point, 2),
        "current_stock_status": stock_status,
        "days_of_supply": round(days_of_supply, 1) if days_of_supply else None,
        "service_level": service_level,
        "z_value": z,
        "method": "standard_safety_stock"
    }


if __name__ == "__main__":
    input_json = json.loads(sys.stdin.read())
    result = main(input_json)
    print(json.dumps(result, ensure_ascii=False))