from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

from app.store import JobStore


@dataclass(frozen=True)
class GenerateOptions:
    texture_resolution: int = 1024
    remesh_option: str = "none"
    target_vertex_count: int = -1
    foreground_ratio: float = 0.85
    drop_lower_ratio: float = 0.0


class Provider(ABC):
    name: str

    @abstractmethod
    def generate(self, *, job_id: str, store: JobStore, options: GenerateOptions) -> None:
        raise NotImplementedError
