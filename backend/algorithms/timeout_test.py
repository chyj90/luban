import time


def main(input_data):
    time.sleep(300)
    return {"done": True}


if __name__ == "__main__":
    import json
    import sys
    input_json = json.loads(sys.stdin.read())
    result = main(input_json)
    print(json.dumps(result, ensure_ascii=False))