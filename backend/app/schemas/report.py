from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel


class FilterCondition(BaseModel):
    field: str
    op: Literal["equals", "contains", "starts_with", "in", "between", "before", "after", "is_empty", "is_not_empty"]
    value: str | list[str] | bool | int | None = None


class FilterGroup(BaseModel):
    logic: Literal["AND", "OR"] = "AND"
    conditions: list[FilterCondition] = []
    groups: list[FilterGroup] = []


FilterGroup.model_rebuild()


class ReportRequest(BaseModel):
    report: str = ""
    filters: FilterGroup = FilterGroup()
    columns: list[str] = []
    page: int = 1
    page_size: int = 50
    sort_by: list[str] = []
    sort_dir: Literal["asc", "desc"] = "asc"


class ReportResponse(BaseModel):
    report: str
    columns: list[str]
    rows: list[dict[str, Any]]
    total: int
    page: int
    page_size: int


class FieldMeta(BaseModel):
    label: str
    type: str
    filter_tier: str | None = None
    filter_group: str | None = None
    operators: list[str]
    filterable: bool
    selectable: bool
    render_as: str
    link_template: str | None = None
    enum_options: list[Any] | None = None


class ReportMeta(BaseModel):
    id: str
    label: str
    fields: dict[str, FieldMeta]
    default_columns: list[str]


class ReportsListResponse(BaseModel):
    reports: list[ReportMeta]
