import json
import sys


def main(input_data):
    defect_rate_series = input_data.get("defect_rate_series", [])
    factor_data = input_data.get("factor_data", {})

    if not defect_rate_series:
        return {"error": "missing_required_field", "field": "defect_rate_series",
                "message": "缺少必填字段 defect_rate_series"}
    if not factor_data:
        return {"error": "missing_required_field", "field": "factor_data",
                "message": "缺少必填字段 factor_data"}

    n = len(defect_rate_series)
    mean_defect = sum(d.get("rate", 0) for d in defect_rate_series) / n if n > 0 else 0

    high_defect_points = [d for d in defect_rate_series if d.get("rate", 0) > mean_defect * 1.5]

    factor_contributions = {}
    for factor_name, factor_values in factor_data.items():
        if not isinstance(factor_values, list) or len(factor_values) != n:
            continue

        defect_rates = [d.get("rate", 0) for d in defect_rate_series]
        mean_f = sum(factor_values) / n
        mean_d = mean_defect

        cov = sum((factor_values[i] - mean_f) * (defect_rates[i] - mean_d) for i in range(n)) / n
        var_f = sum((v - mean_f) ** 2 for v in factor_values) / n
        var_d = sum((v - mean_d) ** 2 for v in defect_rates) / n

        if var_f > 0 and var_d > 0:
            correlation = cov / (var_f ** 0.5 * var_d ** 0.5)
        else:
            correlation = 0

        factor_contributions[factor_name] = round(correlation, 4)

    sorted_factors = sorted(factor_contributions.items(), key=lambda x: abs(x[1]), reverse=True)

    key_factors = []
    total_abs = sum(abs(v) for v in factor_contributions.values()) or 1
    for factor_name, corr in sorted_factors[:5]:
        contribution_pct = abs(corr) / total_abs * 100
        key_factors.append({
            "factor": factor_name,
            "correlation": corr,
            "contribution_pct": round(contribution_pct, 2),
            "direction": "positive" if corr > 0 else "negative"
        })

    top_corr = abs(sorted_factors[0][1]) if sorted_factors else 0
    if top_corr > 0.7:
        confidence = "high"
    elif top_corr > 0.4:
        confidence = "medium"
    else:
        confidence = "low"

    return {
        "key_factors": key_factors,
        "contribution": [{"factor": f["factor"], "contribution_pct": f["contribution_pct"]} for f in key_factors],
        "confidence": confidence,
        "mean_defect_rate": round(mean_defect, 4),
        "high_defect_count": len(high_defect_points),
        "method": "pearson_correlation"
    }


if __name__ == "__main__":
    input_json = json.loads(sys.stdin.read())
    result = main(input_json)
    print(json.dumps(result, ensure_ascii=False))