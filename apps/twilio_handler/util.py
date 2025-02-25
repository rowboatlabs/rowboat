import os
import logging
import datetime
from typing import Dict, Any, Optional, List, Union
import copy
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure, PyMongoError
from pymongo.collection import Collection
from bson import json_util
from pydantic import BaseModel
from rowboat.schema import ApiMessage

# Configure logging to stdout for Docker compatibility
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler()]  # Send logs to stdout
)
logger = logging.getLogger(__name__)

# MongoDB Configuration
MONGODB_URI = os.environ.get('MONGODB_URI')
MONGODB_DB = 'rowboat'

CALL_STATE_COLLECTION = 'call-state'
MONGODB_EXPIRY_SECONDS = 86400  # Default 24 hours
API_KEYS_COLLECTION = "api_keys"
# MongoDB client singleton
_mongo_client = None
_db = None
_call_state_collection = None
_api_keys_collection = None

# Define chat state pydantic model
class CallState(BaseModel):
    messages: List[ApiMessage] = []
    workflow_id: str
    project_id: str
    system_prompt: str
    turn_count: int = 0
    inbound: bool = False
    conversation_history: List[Dict[str, str]] = []  # Using Dict instead of ApiMessage for chat history
    to_number: str = ""
    created_at: int
    state: Any = None  # Allow any type since the API might return a complex state object
    last_transcription: Optional[str] = None

    # Enable dictionary-style access for compatibility with existing code
    def __getitem__(self, key):
        return getattr(self, key)

    def __setitem__(self, key, value):
        setattr(self, key, value)

    def get(self, key, default=None):
        return getattr(self, key, default)

    model_config = {
        # Allow extra fields for flexibility
        "extra": "allow",
        # More lenient type validation
        "arbitrary_types_allowed": True,
        # Allow population by field name
        "populate_by_name": True
    }

def init_mongodb():
    """Initialize MongoDB connection and set up indexes."""
    global _mongo_client, _db, _call_state_collection, _api_keys_collection

    try:
        _mongo_client = MongoClient(MONGODB_URI)
        # Force a command to check the connection
        _mongo_client.admin.command('ping')

        # Set up database and collection
        _db = _mongo_client[MONGODB_DB]
        _call_state_collection = _db[CALL_STATE_COLLECTION]
        _api_keys_collection = _db[API_KEYS_COLLECTION]
        # Create TTL index if it doesn't exist
        if 'expires_at_1' not in _call_state_collection.index_information():
            _call_state_collection.create_index('expires_at', expireAfterSeconds=0)

        logger.info(f"Connected to MongoDB at {MONGODB_URI}")
        return True
    except ConnectionFailure as e:
        logger.error(f"Failed to connect to MongoDB: {str(e)}")
        raise RuntimeError(f"Could not connect to MongoDB: {str(e)}")

def get_collection() -> Collection:
    """Get the MongoDB collection, initializing if needed."""
    global _call_state_collection

    if _call_state_collection is None:
        init_mongodb()

    return _call_state_collection

def get_api_keys_collection() -> Collection:
    """Get the MongoDB collection, initializing if needed."""
    global _api_keys_collection

    if _api_keys_collection is None:
        init_mongodb()

    return _api_keys_collection

def get_api_key(project_id: str) -> Optional[str]:
    """Get the API key for a given project ID."""
    collection = get_api_keys_collection()
    doc = collection.find_one({"projectId": project_id})
    return doc["key"] if doc else None

def save_call_state(call_sid: str, call_state: CallState) -> bool:
    """
    Save call state to MongoDB.

    Args:
        call_sid: The call SID to use as document ID
        call_state: The call state dictionary to save

    Returns:
        True if successful, False otherwise
    """
    try:
        # Validate call_state is a CallState object
        if not isinstance(call_state, CallState):
            raise ValueError(f"call_state must be a CallState object, got {type(call_state)}")

        collection = get_collection()
        # Use call_sid as document ID
        collection.update_one(
            {'_id': call_sid},
            {'$set': call_state.model_dump()},
            upsert=True
        )
        logger.info(f"Saved call state to MongoDB for call {call_sid}")
        return True
    except PyMongoError as e:
        logger.error(f"Error saving call state to MongoDB for call {call_sid}: {str(e)}")
        raise RuntimeError(f"Failed to save call state to MongoDB: {str(e)}")
    except Exception as e:
        logger.error(f"Unexpected error in save_call_state: {str(e)}")
        raise RuntimeError(f"Failed to save call state: {str(e)}")

def get_call_state(call_sid: str) -> Optional[CallState]:
    """
    Retrieve call state from MongoDB.

    Args:
        call_sid: The call SID to retrieve

    Returns:
        Call state dictionary or None if not found
    """
    try:
        collection = get_collection()

        # Query MongoDB for the call state
        state_doc = collection.find_one({'_id': call_sid})
        if not state_doc:
            logger.info(f"No call state found in MongoDB for call {call_sid}")
            return None

        call_state = CallState.model_validate(state_doc)

        logger.info(f"Retrieved call state from MongoDB for call {call_sid}")
        return call_state
    except PyMongoError as e:
        logger.error(f"Error retrieving call state from MongoDB for call {call_sid}: {str(e)}")
        raise RuntimeError(f"Failed to retrieve call state from MongoDB: {str(e)}")
    except Exception as e:
        logger.error(f"Unexpected error in get_call_state: {str(e)}")
        raise RuntimeError(f"Failed to retrieve call state: {str(e)}")

def delete_call_state(call_sid: str) -> bool:
    """
    Delete call state from MongoDB.

    Args:
        call_sid: The call SID to delete

    Returns:
        True if successful, False if not found
    """
    try:
        collection = get_collection()

        # Delete the document from MongoDB
        result = collection.delete_one({'_id': call_sid})
        if result.deleted_count > 0:
            logger.info(f"Deleted call state from MongoDB for call {call_sid}")
            return True
        else:
            logger.info(f"No call state found to delete in MongoDB for call {call_sid}")
            return False
    except PyMongoError as e:
        logger.error(f"Error deleting call state from MongoDB for call {call_sid}: {str(e)}")
        raise RuntimeError(f"Failed to delete call state from MongoDB: {str(e)}")
    except Exception as e:
        logger.error(f"Unexpected error in delete_call_state: {str(e)}")
        raise RuntimeError(f"Failed to delete call state: {str(e)}")

def count_active_calls() -> int:
    """
    Count active call documents in MongoDB.

    Returns:
        Number of active call documents
    """
    try:
        collection = get_collection()
        return collection.count_documents({})
    except PyMongoError as e:
        logger.error(f"Error counting active calls in MongoDB: {str(e)}")
        raise RuntimeError(f"Failed to count active calls in MongoDB: {str(e)}")
    except Exception as e:
        logger.error(f"Unexpected error in count_active_calls: {str(e)}")
        raise RuntimeError(f"Failed to count active calls: {str(e)}")

def get_mongodb_status() -> Dict[str, Any]:
    """
    Get MongoDB connection status information.

    Returns:
        Dictionary with status information
    """
    status = {
        "status": "connected",
        "uri": MONGODB_URI,
        "database": MONGODB_DB,
        "collection": CALL_STATE_COLLECTION
    }

    try:
        # First check connection with a simple command
        collection = get_collection()
        db = collection.database
        db.command('ping')
        status["connection"] = "ok"

        # Count active calls
        count = count_active_calls()
        status["active_calls"] = count

        # Get collection stats
        try:
            stats = db.command("collStats", CALL_STATE_COLLECTION)
            status["size_bytes"] = stats.get("size", 0)
            status["document_count"] = stats.get("count", 0)
            status["index_count"] = len(stats.get("indexSizes", {}))
        except Exception as stats_error:
            status["stats_error"] = str(stats_error)

    except Exception as e:
        status["status"] = "error"
        status["error"] = str(e)
        status["timestamp"] = datetime.datetime.utcnow().isoformat()

    return status

# Twilio configuration functions
def get_twilio_config(phone_number: str) -> Optional[Dict[str, Any]]:
    """
    Get Twilio configuration for a specific phone number from MongoDB.

    Args:
        phone_number: The phone number to look up configuration for

    Returns:
        Configuration dictionary or None if not found/active
    """
    try:
        # Get MongoDB client and database
        client = get_collection().database.client
        db = client[MONGODB_DB]

        # Use the twilio_configs collection
        config_collection = db['twilio_configs']

        # Enhanced logging for phone number format
        logger.info(f"Looking up configuration for phone number: '{phone_number}'")

        # Try different formats of the phone number
        cleaned_number = phone_number.strip().replace(' ', '').replace('-', '').replace('(', '').replace(')', '')

        possible_formats = [
            phone_number,  # Original format from Twilio
            cleaned_number,  # Thoroughly cleaned number
            '+' + cleaned_number if not cleaned_number.startswith('+') else cleaned_number,  # Ensure + prefix

            # Try with different country code formats
            '+1' + cleaned_number[-10:] if len(cleaned_number) >= 10 else cleaned_number,  # US format with +1
            '1' + cleaned_number[-10:] if len(cleaned_number) >= 10 else cleaned_number,   # US format with 1
            cleaned_number[-10:] if len(cleaned_number) >= 10 else cleaned_number,         # US format without country code
        ]

        # Remove duplicates while preserving order
        unique_formats = []
        for fmt in possible_formats:
            if fmt not in unique_formats:
                unique_formats.append(fmt)
        possible_formats = unique_formats

        # Log the formats we're trying
        logger.info(f"Trying phone number formats: {possible_formats}")

        # Try each format
        for phone_format in possible_formats:
            # Look up the configuration for this phone number format with status=active
            config = config_collection.find_one({'phone_number': phone_format, 'status': 'active'})
            if config:
                logger.info(f"Found active configuration for '{phone_format}': project_id={config.get('project_id')}, workflow_id={config.get('workflow_id')}")
                break  # Found a match, exit the loop

        # If we didn't find any match
        if not config:
            # Try a more generic query to see what configurations exist
            try:
                all_configs = list(config_collection.find({'phone_number': {'$regex': phone_number[-10:] if len(phone_number) >= 10 else phone_number}}))
                if all_configs:
                    logger.warning(f"Found {len(all_configs)} configurations that match phone number {phone_number}, but none are active:")
                    for cfg in all_configs:
                        logger.warning(f"  - Phone: {cfg.get('phone_number')}, Status: {cfg.get('status')}, Workflow: {cfg.get('workflow_id')}")
                else:
                    logger.warning(f"No configurations found at all for phone number {phone_number} or related formats")
            except Exception as e:
                logger.error(f"Error running regex query: {str(e)}")

            logger.warning(f"No active configuration found for any format of phone number {phone_number}")
            return None

        # Make sure required fields are present
        if 'project_id' not in config or 'workflow_id' not in config:
            logger.error(f"Configuration for {phone_number} is missing required fields")
            return None

        logger.info(f"Found active configuration for {phone_number}: project_id={config['project_id']}, workflow_id={config['workflow_id']}")
        return config
    except Exception as e:
        logger.error(f"Error retrieving Twilio configuration for {phone_number}: {str(e)}")
        # Return None instead of raising an exception to allow fallback to default behavior
        return None

def list_active_twilio_configs() -> List[Dict[str, Any]]:
    """
    List all active Twilio configurations from MongoDB.

    Returns:
        List of active configuration dictionaries
    """
    try:
        # Get MongoDB client and database
        client = get_collection().database.client
        db = client[MONGODB_DB]

        # Use the twilio_configs collection
        config_collection = db['twilio_configs']

        # Find all active configurations
        configs = list(config_collection.find({'status': 'active'}))

        logger.info(f"Found {len(configs)} active Twilio configurations")
        return configs
    except Exception as e:
        logger.error(f"Error retrieving active Twilio configurations: {str(e)}")
        return []

def save_twilio_config(config: Dict[str, Any]) -> bool:
    """
    Save a Twilio configuration to MongoDB.

    Args:
        config: Configuration dictionary with at least phone_number, project_id, and workflow_id

    Returns:
        True if successful, False otherwise
    """
    required_fields = ['phone_number', 'project_id', 'workflow_id']
    for field in required_fields:
        if field not in config:
            logger.error(f"Missing required field '{field}' in Twilio configuration")
            return False

    try:
        # Get MongoDB client and database
        client = get_collection().database.client
        db = client[MONGODB_DB]

        # Use the twilio_configs collection
        config_collection = db['twilio_configs']

        # Ensure status is set to active
        if 'status' not in config:
            config['status'] = 'active'

        # Add timestamp
        config['updated_at'] = datetime.datetime.utcnow()
        if 'created_at' not in config:
            config['created_at'] = config['updated_at']

        # Use phone_number as the ID
        phone_number = config['phone_number']

        # Update or insert the configuration
        result = config_collection.update_one(
            {'phone_number': phone_number},
            {'$set': config},
            upsert=True
        )

        if result.matched_count > 0:
            logger.info(f"Updated Twilio configuration for {phone_number}")
        else:
            logger.info(f"Created new Twilio configuration for {phone_number}")

        return True
    except Exception as e:
        logger.error(f"Error saving Twilio configuration: {str(e)}")
        return False

# Initialize MongoDB on module import
init_mongodb()