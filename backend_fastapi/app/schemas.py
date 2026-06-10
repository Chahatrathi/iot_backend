from pydantic import BaseModel, EmailStr, Field
from typing import Optional

class FactoryCreate(BaseModel):
    name: str = Field(..., max_length=100)
    location: Optional[str] = Field(None, max_length=255)

class UserCreate(BaseModel):
    username: str
    email: str
    role: str
    factory_id: Optional[int] = None
    password: Optional[str] = None  # Force optional fallback status

class TopologyCreate(BaseModel):
    factory_id: int
    hub_id: str
    relay_mac: str = Field(..., pattern=r'^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$')
    mininode_id: str
    fan_channel: int = Field(..., ge=1, le=6)
    bulb_channel: int = Field(..., ge=1, le=6)