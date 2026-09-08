import json
import sys
from datetime import datetime


def main(input_data):
    plant = input_data.get("plant")
    work_center = input_data.get("work_center")
    material = input_data.get("material")
    order_quantity = input_data.get("order_quantity")
    deadline = input_data.get("deadline")
    daily_capacity = input_data.get("daily_capacity")
    already_scheduled = input_data.get("already_scheduled", 0)
    bom_components = input_data.get("bom_components", [])
    available_stock = input_data.get("available_stock", {})
    routing_steps = input_data.get("routing_steps", [])
    equipment_availability = input_data.get("equipment_availability")

    errors = []
    if not work_center:
        errors.append("缺少必填字段 work_center")
    if not material:
        errors.append("缺少必填字段 material")
    if order_quantity is None:
        errors.append("缺少必填字段 order_quantity")
    if daily_capacity is None:
        errors.append("缺少必填字段 daily_capacity（由 LLM 从 CRCA 查询后传入）")
    if errors:
        return {"feasible": False, "error": "missing_required", "details": errors}

    if daily_capacity <= 0:
        return {"feasible": False, "bottleneck": "capacity_zero",
                "message": f"工作中心 {work_center} 额定产能为 0，无法排产"}

    result = {
        "plant": plant,
        "work_center": work_center,
        "material": material,
        "order_quantity": order_quantity,
    }

    remaining_capacity = daily_capacity - already_scheduled
    result["remaining_capacity"] = remaining_capacity
    result["utilization_after"] = round((already_scheduled + order_quantity) / daily_capacity, 4)

    bottlenecks = []

    if remaining_capacity <= 0:
        bottlenecks.append({
            "type": "capacity_exhausted",
            "message": f"{work_center} 已满负荷（已排 {already_scheduled}，产能 {daily_capacity}）"
        })
    else:
        required_days = order_quantity / remaining_capacity
        result["required_days"] = round(required_days, 2)

        if deadline:
            try:
                deadline_date = datetime.strptime(deadline, "%Y-%m-%d")
                days_to_deadline = (deadline_date - datetime.now()).days
                result["days_to_deadline"] = days_to_deadline
                if required_days > days_to_deadline:
                    bottlenecks.append({
                        "type": "deadline_unreachable",
                        "message": f"交期不可达：需 {required_days:.1f} 天，距交期仅 {days_to_deadline} 天"
                    })
            except ValueError:
                bottlenecks.append({
                    "type": "invalid_deadline",
                    "message": f"交期格式错误：{deadline}，应为 YYYY-MM-DD"
                })

    if bom_components and available_stock:
        shortages = []
        for comp in bom_components:
            comp_mat = comp.get("material", "")
            comp_qty = comp.get("quantity_per_unit", 0) * order_quantity
            comp_unit = comp.get("unit", "EA")
            stock = available_stock.get(comp_mat, 0)
            if stock < comp_qty:
                shortages.append({
                    "material": comp_mat,
                    "required": round(comp_qty, 2),
                    "available": stock,
                    "shortage": round(comp_qty - stock, 2),
                    "unit": comp_unit
                })
        if shortages:
            shortage_desc = ", ".join(
                f"{s['material']}缺{s['shortage']}{s['unit']}" for s in shortages
            )
            bottlenecks.append({
                "type": "material_shortage",
                "shortages": shortages,
                "message": f"物料不齐套：{shortage_desc}"
            })
        result["material_check"] = {"shortages": shortages, "all_sufficient": len(shortages) == 0}

    if routing_steps:
        total_machine_hours = sum(s.get("machine_hours", 0) for s in routing_steps)
        result["total_machine_hours"] = round(total_machine_hours, 2)
        work_hours_per_day = 24
        if total_machine_hours > 0 and daily_capacity > 0:
            routing_days = total_machine_hours / work_hours_per_day
            result["routing_days"] = round(routing_days, 2)

    if equipment_availability is not None:
        result["equipment_availability"] = equipment_availability
        if equipment_availability < 0.8:
            bottlenecks.append({
                "type": "equipment_risk",
                "message": f"设备可用率 {equipment_availability:.1%}，低于 80% 安全阈值"
            })

    feasible = len(bottlenecks) == 0
    result["feasible"] = feasible
    result["bottlenecks"] = bottlenecks
    result["suggested_start"] = datetime.now().strftime("%Y-%m-%d") if feasible else None

    if not feasible:
        result["summary"] = "；".join(b["message"] for b in bottlenecks)
    else:
        result["summary"] = f"{work_center} 可承接 {material} {order_quantity} 件"

    return result


if __name__ == "__main__":
    input_json = json.loads(sys.stdin.read())
    result = main(input_json)
    print(json.dumps(result, ensure_ascii=False))