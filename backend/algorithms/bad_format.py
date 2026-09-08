def main(input_data):
    print("success: 42")
    return {}


if __name__ == "__main__":
    import json
    import sys
    input_json = json.loads(sys.stdin.read())
    result = main(input_json)
    print(json.dumps(result, ensure_ascii=False))