from sqlalchemy import create_engine, Column, Integer, String, ForeignKey
from sqlalchemy.orm import declarative_base, sessionmaker, relationship

engine = create_engine("sqlite:///./library.db", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class Track(Base):
    __tablename__ = "tracks"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    filename = Column(String, unique=True, nullable=False)
    source_url = Column(String, nullable=True)

class Playlist(Base):
    __tablename__ = "playlists"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    owner_user_id = Column(String, nullable=False)
    
    # Relacionamento com PlaylistTrack
    tracks = relationship("PlaylistTrack", back_populates="playlist", cascade="all, delete-orphan")

class PlaylistTrack(Base):
    __tablename__ = "playlist_tracks"
    id = Column(Integer, primary_key=True, index=True)
    playlist_id = Column(Integer, ForeignKey("playlists.id"), nullable=False)
    track_id = Column(Integer, ForeignKey("tracks.id"), nullable=False)
    position = Column(Integer, nullable=False)
    
    # Relacionamentos
    playlist = relationship("Playlist", back_populates="tracks")
    track = relationship("Track")

def init_db():
    Base.metadata.create_all(bind=engine)
