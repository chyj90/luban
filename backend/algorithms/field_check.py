import json


def main(input_data):
    required = ["daily_capacity", "order_quantity"]
    for f in required:
        if f not in input_data:
            return {"error": "missing_required_field", "field": f,
                    "message": f"缺少必填字段 {f}"}
    return {"feasible": True}


if __name__ == "__main__":
    import sys
    input_json = json.loads(sys.stdin.read())
    result = main(input_json)
    print(json.dumps(result, ensure_ascii=False))