"""Pydantic input/output models for MCP tools."""

from pydantic import BaseModel, Field
from typing import Optional


class AnalyzePhotoInput(BaseModel):
    file_path: str = Field(description="Absolute path to JPEG or TIFF file")
    target_sizes: Optional[list[str]] = Field(
        default=["8x10", "16x20", "24x36", "30x40", "40x60", "60x90"],
        description="Print sizes to evaluate (inches, WxH)",
    )
    dpi_threshold: Optional[int] = Field(
        default=200,
        description="Minimum DPI for 'sellable' verdict (150-300)",
    )


class BatchAnalyzeInput(BaseModel):
    folder_path: str = Field(description="Path to folder containing images")
    recursive: bool = Field(default=True, description="Include subfolders")
    min_grade: Optional[str] = Field(default="C", description="Minimum grade to include (A/B/C/D/F)")
    target_size: Optional[str] = Field(default="24x36", description="Target print size to evaluate against")
    output_csv: Optional[str] = Field(default=None, description="Path to save CSV catalog report")


class PrintReadinessInput(BaseModel):
    file_path: str = Field(description="Absolute path to image file")
    print_width: float = Field(description="Print width in inches")
    print_height: float = Field(description="Print height in inches")
    quality_level: str = Field(
        default="high",
        description="'gallery' (300dpi), 'high' (200dpi), 'standard' (150dpi)",
    )


class CompareInput(BaseModel):
    file_a: str = Field(description="Path to first image")
    file_b: str = Field(description="Path to second image")
